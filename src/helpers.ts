import { sortBy, filter, first } from 'lodash';
import {
  DIRECTION_DOWN,
  DIRECTION_UP,
  DIRECTION_LEFT,
  DIRECTION_RIGHT
} from './constants';
import {
  FocusableComponent,
  FocusableComponentLayout,
  FocusDetails,
  SpatialNavigationService,
  Corners
} from './types';

const ADJACENT_SLICE_THRESHOLD = 0.2;

/**
 * Adjacent slice is 5 times more important than diagonal
 */
const ADJACENT_SLICE_WEIGHT = 5;
const DIAGONAL_SLICE_WEIGHT = 1;

/**
 * Main coordinate distance is 5 times more important
 */
const MAIN_COORDINATE_WEIGHT = 5;

function getPrimaryAxisDistance(
  refCorners: Corners,
  siblingCorners: Corners,
  isVerticalDirection: boolean
) {
  const { a: refA } = refCorners;
  const { a: siblingA } = siblingCorners;
  const coordinate = isVerticalDirection ? 'y' : 'x';

  return Math.abs(siblingA[coordinate] - refA[coordinate]);
}

function getSecondaryAxisDistance(
  refCorners: Corners,
  siblingCorners: Corners,
  isVerticalDirection: boolean
) {
  const { a: refA, b: refB } = refCorners;
  const { a: siblingA, b: siblingB } = siblingCorners;
  const coordinate = isVerticalDirection ? 'x' : 'y';

  const refCoordinateA = refA[coordinate];
  const refCoordinateB = refB[coordinate];
  const siblingCoordinateA = siblingA[coordinate];
  const siblingCoordinateB = siblingB[coordinate];

  const distancesToCompare = [];

  distancesToCompare.push(Math.abs(siblingCoordinateA - refCoordinateA));
  distancesToCompare.push(Math.abs(siblingCoordinateA - refCoordinateB));
  distancesToCompare.push(Math.abs(siblingCoordinateB - refCoordinateA));
  distancesToCompare.push(Math.abs(siblingCoordinateB - refCoordinateB));

  return Math.min(...distancesToCompare);
}

/**
 * Returns two corners (a and b) coordinates that are used as a reference points
 * Where "a" is always leftmost and topmost corner, and "b" is rightmost bottommost corner
 */
function getRefCorners(
  direction: string,
  isSibling: boolean,
  layout: FocusableComponentLayout
) {
  const itemX = layout.left;
  const itemY = layout.top;
  const itemWidth = layout.width;
  const itemHeight = layout.height;

  const result = {
    a: {
      x: 0,
      y: 0
    },
    b: {
      x: 0,
      y: 0
    }
  };

  switch (direction) {
    case DIRECTION_UP: {
      const y = isSibling ? itemY + itemHeight : itemY;

      result.a = {
        x: itemX,
        y
      };

      result.b = {
        x: itemX + itemWidth,
        y
      };

      break;
    }

    case DIRECTION_DOWN: {
      const y = isSibling ? itemY : itemY + itemHeight;

      result.a = {
        x: itemX,
        y
      };

      result.b = {
        x: itemX + itemWidth,
        y
      };

      break;
    }

    case DIRECTION_LEFT: {
      const x = isSibling ? itemX + itemWidth : itemX;

      result.a = {
        x,
        y: itemY
      };

      result.b = {
        x,
        y: itemY + itemHeight
      };

      break;
    }

    case DIRECTION_RIGHT: {
      const x = isSibling ? itemX : itemX + itemWidth;

      result.a = {
        x,
        y: itemY
      };

      result.b = {
        x,
        y: itemY + itemHeight
      };

      break;
    }

    default:
      break;
  }

  return result;
}

/**
 * Calculates if the sibling node is intersecting enough with the ref node by the secondary coordinate
 */
function getIsAdjacentSlice(
    refCorners: Corners,
    siblingCorners: Corners,
    isVerticalDirection: boolean
  ) {
    const { a: refA, b: refB } = refCorners;
    const { a: siblingA, b: siblingB } = siblingCorners;
    const coordinate = isVerticalDirection ? 'x' : 'y';
  
    const refCoordinateA = refA[coordinate];
    const refCoordinateB = refB[coordinate];
    const siblingCoordinateA = siblingA[coordinate];
    const siblingCoordinateB = siblingB[coordinate];
  
    const thresholdDistance =
      (refCoordinateB - refCoordinateA) * ADJACENT_SLICE_THRESHOLD;
  
    const intersectionLength = Math.max(
      0,
      Math.min(refCoordinateB, siblingCoordinateB) -
        Math.max(refCoordinateA, siblingCoordinateA)
    );
  
    return intersectionLength >= thresholdDistance;
  }

/**
 * Inspired by: https://developer.mozilla.org/en-US/docs/Mozilla/Firefox_OS_for_TV/TV_remote_control_navigation#Algorithm_design
 * Ref Corners are the 2 corners of the current component in the direction of navigation
 * They used as a base to measure adjacent slices
 */
function sortSiblingsByPriority(
  siblings: FocusableComponent[],
  currentLayout: FocusableComponentLayout,
  direction: string
) {
  const isVerticalDirection =
    direction === DIRECTION_DOWN || direction === DIRECTION_UP;

  const refCorners = getRefCorners(direction, false, currentLayout);

  return sortBy(siblings, (sibling) => {
    const siblingCorners = getRefCorners(direction, true, sibling.layout);

    const isAdjacentSlice = getIsAdjacentSlice(
      refCorners,
      siblingCorners,
      isVerticalDirection
    );

    const primaryAxisFunction = isAdjacentSlice
      ? getPrimaryAxisDistance
      : getSecondaryAxisDistance;

    const secondaryAxisFunction = isAdjacentSlice
      ? getSecondaryAxisDistance
      : getPrimaryAxisDistance;

    const primaryAxisDistance = primaryAxisFunction(
      refCorners,
      siblingCorners,
      isVerticalDirection
    );
    const secondaryAxisDistance = secondaryAxisFunction(
      refCorners,
      siblingCorners,
      isVerticalDirection
    );

    /**
     * The higher this value is, the less prioritised the candidate is
     */
    const totalDistancePoints =
      primaryAxisDistance * MAIN_COORDINATE_WEIGHT + secondaryAxisDistance;

    /**
     * + 1 here is in case of distance is zero, but we still want to apply Adjacent priority weight
     */
    const priority =
      (totalDistancePoints + 1) /
      (isAdjacentSlice ? ADJACENT_SLICE_WEIGHT : DIAGONAL_SLICE_WEIGHT);

    return priority;
  });
}

/**
 * This function navigates between siblings OR goes up by the Tree
 * Based on the Direction
 */
function smartNavigate(
  focusKey: string,
  direction: string,
  focusDetails: FocusDetails,
  svc: SpatialNavigationService
) {
  const focusableComponents = svc.getFocusableComponents();
  const fromComponent = focusableComponents[focusKey];

  if (!fromComponent || fromComponent.isFocusBoundary) {
    return;
  }

  // Optimization
  // this.updateLayout(currentComponent.focusKey);

  // @todo allow this logic to be overwritten for each "context" and export logic below as default.
  // This is definitely testable without a browser.
  const isNodeFocusable = (
    dir: string,
    from: FocusableComponent,
    to: FocusableComponent
  ) => {
    if (!to.focusable) {
      return false;
    }
    if (from.focusKey === to.focusKey) {
      return false;
    }
    if (from.parentFocusKey !== to.parentFocusKey) {
      return false;
    }

    // Check that the next component is in the direction of the current component.
    // For example, if direction is "left" we check that the next component is to the left of current.
    let isValidDirectionally;

    // This is a simple algo that only works in a grid
    switch (dir) {
      case DIRECTION_LEFT: {
        // Check that the right edge of the next is to the left of the left edge of the current
        const rightEdgeNext = to.layout.left + to.layout.width;
        const leftEdgeCurrent = from.layout.left;
        if (leftEdgeCurrent >= rightEdgeNext) {
          isValidDirectionally = true;
        }
        break;
      }
      case DIRECTION_RIGHT: {
        const leftEdgeNext = to.layout.left;
        const rightEdgeCurrent = from.layout.left + from.layout.width;
        if (rightEdgeCurrent <= leftEdgeNext) {
          isValidDirectionally = true;
        }
        break;
      }
      case DIRECTION_DOWN: {
        const topEdgeNext = to.layout.top;
        const bottomEdgeCurrent = from.layout.top + from.layout.height;
        if (topEdgeNext >= bottomEdgeCurrent) {
          isValidDirectionally = true;
        }
        break;
      }
      case DIRECTION_UP: {
        const bottomEdgeNext = to.layout.top + to.layout.height;
        const topEdgeCurrent = from.layout.top;
        if (topEdgeCurrent >= bottomEdgeNext) {
          isValidDirectionally = true;
        }
        break;
      }
      default:
        isValidDirectionally = false;
    }

    return isValidDirectionally;
  };

  const siblings = filter(focusableComponents, (nextComponent) =>
    isNodeFocusable(direction, fromComponent, nextComponent)
  );

  const sortedSiblingsInCurrentDirection = sortSiblingsByPriority(
    siblings,
    fromComponent.layout,
    direction
  );

  const nextComponent = first(sortedSiblingsInCurrentDirection);

  if (nextComponent) {
    svc.setFocus(nextComponent.focusKey, focusDetails);
    return;
  }

  const parentComponent = focusableComponents[fromComponent.parentFocusKey];

  svc.saveLastFocusedChildKey(parentComponent, fromComponent.focusKey);

  smartNavigate(fromComponent.parentFocusKey, direction, focusDetails, svc);
}

const getChildClosestToOrigin = (children: FocusableComponent[]) => {
    const childrenClosestToOrigin = sortBy(
      children,
      ({ layout }) => Math.abs(layout.left) + Math.abs(layout.top)
    );
  
    return first(childrenClosestToOrigin);
  };

export { getChildClosestToOrigin, smartNavigate }

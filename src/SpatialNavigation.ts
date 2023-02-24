import { DebouncedFunc } from 'lodash';
import filter from 'lodash/filter';
import findKey from 'lodash/findKey';
import forEach from 'lodash/forEach';
import forOwn from 'lodash/forOwn';
import throttle from 'lodash/throttle';
import difference from 'lodash/difference';
import VisualDebugger from './VisualDebugger';
import {
  BackwardsCompatibleKeyMap,
  FocusableComponent,
  FocusableComponentRemovePayload,
  FocusableComponentUpdatePayload,
  FocusDetails,
  KeyMap,
  KeyPressDetails,
  PressedKeys,
  SpatialNavigationService
} from './types';
import {
  DEBUG_FN_COLORS,
  DEFAULT_KEY_MAP,
  KEY_ENTER,
  THROTTLE_OPTIONS
} from './constants';
import { getChildClosestToOrigin, measureLayout, normalizeKeyMap } from './helpers';

// Separate out the algorithms for:
// - Calculating node location
// - Finding next focusable item
// - Benchmarks:
// - Number of items it can load
// - Number of items it can compare against
// - Small number of elements vs. big number of elements
class SpatialNavigationServiceClass implements SpatialNavigationService {
  private focusableComponents: { [index: string]: FocusableComponent };

  private visualDebugger: VisualDebugger;

  /**
   * Focus key of the currently focused element
   */
  private focusKey: string;

  /**
   * This collection contains focus keys of the elements that are having a child focused
   * Might be handy for styling of certain parent components if their child is focused.
   */
  private parentsHavingFocusedChild: string[];

  private enabled: boolean;

  /**
   * Throttling delay for key presses in milliseconds
   */
  private throttle: number;

  /**
   * Enables/disables throttling feature
   */
  private throttleKeypresses: boolean;

  /**
   * Storing pressed keys counter by the eventType
   */
  private pressedKeys: PressedKeys;

  /**
   * Flag used to block key events from this service
   */
  private paused: boolean;

  private keyDownEventListener: (event: KeyboardEvent) => void;

  private keyDownEventListenerThrottled: DebouncedFunc<
    (event: KeyboardEvent) => void
  >;

  private keyUpEventListener: (event: KeyboardEvent) => void;

  private keyMap: KeyMap;

  private debug: boolean;

  private logIndex: number;

  constructor() {
    /**
     * Storage for all focusable components
     */
    this.focusableComponents = {};

    /**
     * Storing current focused key
     */
    this.focusKey = null;

    /**
     * This collection contains focus keys of the elements that are having a child focused
     * Might be handy for styling of certain parent components if their child is focused.
     */
    this.parentsHavingFocusedChild = [];

    this.enabled = false;
    this.throttle = 0;
    this.throttleKeypresses = false;

    this.pressedKeys = {};

    /**
     * Flag used to block key events from this service
     * @type {boolean}
     */
    this.paused = false;

    this.keyDownEventListener = null;
    this.keyUpEventListener = null;
    this.keyMap = DEFAULT_KEY_MAP;

    this.onKeyEvent = this.onKeyEvent.bind(this);
    this.pause = this.pause.bind(this);
    this.resume = this.resume.bind(this);
    this.getFocusableComponents = this.getFocusableComponents.bind(this);
    this.getFocusableComponent = this.getFocusableComponent.bind(this);
    this.focus = this.focus.bind(this);
    this.updateAllLayouts = this.updateAllLayouts.bind(this);
    this.init = this.init.bind(this);
    this.setThrottle = this.setThrottle.bind(this);
    this.destroy = this.destroy.bind(this);
    this.setKeyMap = this.setKeyMap.bind(this);
    this.getCurrentFocusKey = this.getCurrentFocusKey.bind(this);

    this.debug = false;
    this.visualDebugger = null;

    this.logIndex = 0;
  }

  init({
    debug = false,
    visualDebug = false,
    throttle: throttleParam = 0,
    throttleKeypresses = false
  } = {}) {
    if (!this.enabled) {
      this.enabled = true;
      this.throttleKeypresses = throttleKeypresses;

      this.debug = debug;

      if (Number.isInteger(throttleParam) && throttleParam > 0) {
        this.throttle = throttleParam;
      }
      this.bindEventHandlers();
      if (visualDebug) {
        this.visualDebugger = new VisualDebugger();
        this.startDrawLayouts();
      }
    }
  }

  destroy() {
    if (this.enabled) {
      this.enabled = false;
      this.throttle = 0;
      this.throttleKeypresses = false;
      this.focusKey = null;
      this.parentsHavingFocusedChild = [];
      this.focusableComponents = {};
      this.paused = false;
      this.keyMap = DEFAULT_KEY_MAP;

      this.unbindEventHandlers();
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  bindEventHandlers() {
    // We check both because the React Native remote debugger implements window, but not window.addEventListener.
    if (typeof window !== 'undefined' && window.addEventListener) {
      this.keyDownEventListener = (event: KeyboardEvent) => {
        if (this.paused === true) {
          return;
        }

        if (this.debug) {
          this.logIndex += 1;
        }

        const eventType = this.getEventType(event.keyCode);

        if (!eventType) {
          return;
        }

        this.pressedKeys[eventType] = this.pressedKeys[eventType]
          ? this.pressedKeys[eventType] + 1
          : 1;

        event.preventDefault();
        event.stopPropagation();

        const keysDetails = {
          pressedKeys: this.pressedKeys
        };

        if (eventType === KEY_ENTER && this.focusKey) {
          this.onEnterPress(keysDetails);

          return;
        }

        const preventDefaultNavigation =
          this.onArrowPress(eventType, keysDetails) === false;

        if (preventDefaultNavigation) {
          this.log('keyDownEventListener', 'default navigation prevented');

          if (this.visualDebugger) {
            this.visualDebugger.clear();
          }
        } else {
          this.onKeyEvent(event);
        }
      };

      // Apply throttle only if the option we got is > 0 to avoid limiting the listener to every animation frame
      if (this.throttle) {
        this.keyDownEventListenerThrottled = throttle(
          this.keyDownEventListener.bind(this),
          this.throttle,
          THROTTLE_OPTIONS
        );
      }

      // When throttling then make sure to only throttle key down and cancel any queued functions in case of key up
      this.keyUpEventListener = (event: KeyboardEvent) => {
        const eventType = this.getEventType(event.keyCode);

        delete this.pressedKeys[eventType];

        if (this.throttle && !this.throttleKeypresses) {
          this.keyDownEventListenerThrottled.cancel();
        }

        if (eventType === KEY_ENTER && this.focusKey) {
          this.onEnterRelease();
        }
      };

      window.addEventListener('keyup', this.keyUpEventListener);
      window.addEventListener(
        'keydown',
        this.throttle
          ? this.keyDownEventListenerThrottled
          : this.keyDownEventListener
      );
    }
  }

  unbindEventHandlers() {
    // We check both because the React Native remote debugger implements window, but not window.removeEventListener.
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('keyup', this.keyUpEventListener);
      this.keyUpEventListener = null;

      const listener = this.throttle
        ? this.keyDownEventListenerThrottled
        : this.keyDownEventListener;

      window.removeEventListener('keydown', listener);
      this.keyDownEventListener = null;
    }
  }

  setThrottle({
    throttle: throttleParam = 0,
    throttleKeypresses = false
  } = {}) {
    this.throttleKeypresses = throttleKeypresses;

    this.unbindEventHandlers();
    if (Number.isInteger(throttleParam)) {
      this.throttle = throttleParam;
    }
    this.bindEventHandlers();
  }

  addFocusable({
    focusKey,
    node,
    parentFocusKey,
    onEnterPress,
    onEnterRelease,
    onArrowPress,
    onFocus,
    onBlur,
    onNavigate,
    saveLastFocusedChild,
    trackChildren,
    onUpdateFocus,
    onUpdateHasFocusedChild,
    preferredChildFocusKey,
    autoRestoreFocus,
    focusable,
    isFocusBoundary,
    pointerSupport
  }: FocusableComponent) {
    this.focusableComponents[focusKey] = {
      focusKey,
      node,
      parentFocusKey,
      onEnterPress,
      onEnterRelease,
      onArrowPress,
      onFocus,
      onBlur,
      onUpdateFocus,
      onUpdateHasFocusedChild,
      onNavigate,
      saveLastFocusedChild,
      trackChildren,
      preferredChildFocusKey,
      focusable,
      isFocusBoundary,
      pointerSupport,
      autoRestoreFocus,
      lastFocusedChildKey: null,
      layout: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        left: 0,
        top: 0,

        /**
         * Node ref is also duplicated in layout to be reported in onFocus callback
         */
        node
      },
      layoutUpdated: false
    };

    this.updateLayout(focusKey);
    this.updatePointerSupport(focusKey, pointerSupport);

    /**
     * If for some reason this component was already focused before it was added, call the update
     */
    if (focusKey === this.focusKey) {
      this.focus(focusKey);
    }
  }

  updateFocusable(
    focusKey: string,
    {
      node,
      preferredChildFocusKey,
      focusable,
      isFocusBoundary,
      pointerSupport,
      onEnterPress,
      onEnterRelease,
      onArrowPress,
      onFocus,
      onBlur,
      onNavigate
    }: FocusableComponentUpdatePayload
  ) {
    const component = this.focusableComponents[focusKey];

    if (component) {
      component.preferredChildFocusKey = preferredChildFocusKey;
      component.focusable = focusable;
      component.isFocusBoundary = isFocusBoundary;
      component.onEnterPress = onEnterPress;
      component.onEnterRelease = onEnterRelease;
      component.onArrowPress = onArrowPress;
      component.onFocus = onFocus;
      component.onBlur = onBlur;
      component.onNavigate = onNavigate;

      this.updatePointerSupport(focusKey, false);

      if (node) {
        component.node = node;
      }

      this.updatePointerSupport(focusKey, pointerSupport);
    }
  }

  removeFocusable({ focusKey }: FocusableComponentRemovePayload) {
    const componentToRemove = this.focusableComponents[focusKey];

    if (componentToRemove) {
      const { parentFocusKey } = componentToRemove;

      this.updatePointerSupport(focusKey, false);

      delete this.focusableComponents[focusKey];

      const parentComponent = this.focusableComponents[parentFocusKey];
      const isFocused = focusKey === this.focusKey;

      /**
       * If the component was stored as lastFocusedChild, clear lastFocusedChildKey from parent
       */
      if (parentComponent && parentComponent.lastFocusedChildKey === focusKey) {
        parentComponent.lastFocusedChildKey = null;
      }

      forEach(this.focusableComponents, (component) => {
        if (component.parentFocusKey === focusKey && component.focusable) {
          // eslint-disable-next-line no-param-reassign
          component.parentFocusKey = parentFocusKey;
        }
      });

      /**
       * If the component was also focused at this time, focus another one
       */
      if (isFocused && parentComponent && parentComponent.autoRestoreFocus) {
        this.focus(parentFocusKey);
      }
    }
  }

  updatePointerSupport(focusKey: string, support: boolean) {
    if (support) {
      this.focusableComponents[focusKey].node.onmouseenter = () => {
        if (this.isParticipatingFocusableChild(focusKey)) {
          this.focus(focusKey);
        }
      };
    } else {
      this.focusableComponents[focusKey].node.onmouseenter = null;
    }
  }

  onEnterPress(keysDetails: KeyPressDetails) {
    const component = this.focusableComponents[this.focusKey];

    /* Guard against last-focused component being unmounted at time of onEnterPress (e.g due to UI fading out) */
    if (!component) {
      this.log('onEnterPress', 'noComponent');

      return;
    }

    /* Suppress onEnterPress if the last-focused item happens to lose its 'focused' status. */
    if (!component.focusable) {
      this.log('onEnterPress', 'componentNotFocusable');

      return;
    }

    if (component.onEnterPress) {
      component.onEnterPress(keysDetails);
    }
  }

  onEnterRelease() {
    const component = this.focusableComponents[this.focusKey];

    /* Guard against last-focused component being unmounted at time of onEnterRelease (e.g due to UI fading out) */
    if (!component) {
      this.log('onEnterRelease', 'noComponent');

      return;
    }

    /* Suppress onEnterRelease if the last-focused item happens to lose its 'focused' status. */
    if (!component.focusable) {
      this.log('onEnterRelease', 'componentNotFocusable');

      return;
    }

    if (this.visualDebugger) {
      this.drawComponentCorners(this.focusKey, 'green');

      this.updateLayout(this.focusKey);

      this.drawComponentCorners(this.focusKey, 'red');
    }

    this.log('onEnterRelease', 'layout', component);

    if (component.onEnterRelease) {
      component.onEnterRelease();
    }
  }

  onArrowPress(direction: string, keysDetails: KeyPressDetails) {
    const component = this.focusableComponents[this.focusKey];

    /* Guard against last-focused component being unmounted at time of onArrowPress (e.g due to UI fading out) */
    if (!component) {
      this.log('onArrowPress', 'noComponent');

      return undefined;
    }

    /* It's okay to navigate AWAY from an item that has lost its 'focused' status, so we don't inspect
     * component.focusable. */

    return (
      component &&
      component.onArrowPress &&
      component.onArrowPress(direction, keysDetails)
    );
  }

  onKeyEvent(event: KeyboardEvent) {
    if (this.visualDebugger) {
      this.visualDebugger.clear();
    }

    const direction = findKey(this.getKeyMap(), (codeList) =>
      codeList.includes(event.keyCode)
    );

    const focusableComponent = this.focusableComponents[this.focusKey];
    focusableComponent.onNavigate(this.focusKey, direction, { event }, this);

    this.updateAllLayouts();
  }

  onIntermediateNodeBecameFocused(
    focusKey: string,
    focusDetails: FocusDetails
  ) {
    if (this.isParticipatingFocusableComponent(focusKey)) {
      this.focusableComponents[focusKey].onFocus(
        this.getNodeLayoutByFocusKey(focusKey),
        focusDetails
      );
    }
  }

  onIntermediateNodeBecameBlurred(
    focusKey: string,
    focusDetails: FocusDetails
  ) {
    if (this.isParticipatingFocusableComponent(focusKey)) {
      this.focusableComponents[focusKey].onBlur(
        this.getNodeLayoutByFocusKey(focusKey),
        focusDetails
      );
    }
  }

  /**
   * Focuses on `targetFocusKey` using the following algorithm.
   * 
   * - If the target component is a leaf node, it is valid for focus.
   * - If the target component is a parent, checks for the following (in this order):
   *    1. Last focused child - `lastFocusedChildKey`
   *    2. Preferred child - `preferredChildFocusKey`
   *    3. Closest child to the topleft corner of the page
   * 
   * Once a valid target is found:
   * 1. Calls old focused component's `onBlur` handler
   * 2. Updates value of `focusKey`
   * 3. Calls new focused component's `onFocus` handler
   * 
   * @param targetFocusKey a parent or leaf node to focus on
   * @param focusDetails (optional) extra information passed in to `onFocus` and `onBlur` callback handlers
   */
  public focus(targetFocusKey: string, focusDetails: FocusDetails = {}) {
    if (!this.enabled) {
      return;
    }

    this.log('setFocus', 'focusKey', targetFocusKey);

    const oldFocusKey = this.focusKey;
    const newFocusKey = this.getValidLeafFocusKey(targetFocusKey);

    this.log('setFocus', 'newFocusKey', newFocusKey);

    const oldFocusableComponent = this.getFocusableComponent(oldFocusKey);
    const newFocusableComponent = this.getFocusableComponent(newFocusKey);

    if (oldFocusableComponent && oldFocusKey !== newFocusKey) {
      oldFocusableComponent.onUpdateFocus(false);
      oldFocusableComponent.onBlur(
        this.getNodeLayoutByFocusKey(oldFocusKey),
        focusDetails
      );
    }

    this.focusKey = newFocusKey;

    if (newFocusableComponent && oldFocusKey !== newFocusKey) {
      newFocusableComponent.onUpdateFocus(true);
      newFocusableComponent.onFocus(
        this.getNodeLayoutByFocusKey(newFocusKey),
        focusDetails
      );
    }

    this.updateParentsHasFocusedChild(newFocusKey, focusDetails);
    this.updateParentsLastFocusedChild(oldFocusKey);
  }

  /**
   * Uses the structure of the focusableComponent tree to find a valid leaf node for focus.
   *
   * If the target component is a parent, checks for the following (in this order):
   * - Last focused child (`lastFocusedChildKey`)
   * - Preferred child (`preferredChildFocusKey`) (@todo rename for consistency)
   * - Topleft most node
   *
   */
  private getValidLeafFocusKey(targetFocusKey: string): string {
    const targetComponent = this.getFocusableComponent(targetFocusKey);

    /**
     * Security check, if component doesn't exist, stay on the same focusKey
     */
    if (!targetComponent) {
      return this.focusKey;
    }

    const { lastFocusedChildKey, preferredChildFocusKey } = targetComponent;

    this.log('getNextFocusKey', 'lastFocusedChildKey is', lastFocusedChildKey);
    this.log(
      'getNextFocusKey',
      'preferredChildFocusKey is',
      preferredChildFocusKey
    );

    /**
     * First of all trying to focus last focused child
     * @todo - check that this is a child?
     */
    if (
      lastFocusedChildKey &&
      targetComponent.saveLastFocusedChild &&
      this.isParticipatingFocusableComponent(lastFocusedChildKey)
    ) {
      this.log(
        'getNextFocusKey',
        'lastFocusedChildKey will be focused',
        lastFocusedChildKey
      );

      return this.getValidLeafFocusKey(lastFocusedChildKey);
    }

    /**
     * If there is no lastFocusedChild, trying to focus the preferred focused key
     * @todo - check that this is a child?
     */
    if (
      preferredChildFocusKey &&
      this.isParticipatingFocusableComponent(preferredChildFocusKey)
    ) {
      this.log(
        'getNextFocusKey',
        'preferredChildFocusKey will be focused',
        preferredChildFocusKey
      );

      return this.getValidLeafFocusKey(preferredChildFocusKey);
    }

    const participatingChildren = filter(
      this.focusableComponents,
      (component) =>
        component.parentFocusKey === targetFocusKey && component.focusable
    );

    if (participatingChildren.length > 0) {
      /**
       * Otherwise, trying to focus something by coordinates
       */
      participatingChildren.forEach((component) =>
        this.updateLayout(component.focusKey)
      );
      const { focusKey: childKey } = getChildClosestToOrigin(
        participatingChildren
      );

      this.log('getNextFocusKey', 'childKey will be focused', childKey);

      return this.getValidLeafFocusKey(childKey);
    }

    /**
     * If no children, just return targetFocusKey back
     */
    this.log('getNextFocusKey', 'targetFocusKey', targetFocusKey);

    return targetFocusKey;
  }

  getNodeLayoutByFocusKey(focusKey: string) {
    const component = this.focusableComponents[focusKey];

    if (component) {
      this.updateLayout(component.focusKey);

      return component.layout;
    }

    return null;
  }

  updateParentsHasFocusedChild(focusKey: string, focusDetails: FocusDetails) {
    const parents = [];

    let currentComponent = this.focusableComponents[focusKey];

    /**
     * Recursively iterate the tree up and find all the parents' focus keys
     */
    while (currentComponent) {
      const { parentFocusKey } = currentComponent;

      const parentComponent = this.focusableComponents[parentFocusKey];

      if (parentComponent) {
        const { focusKey: currentParentFocusKey } = parentComponent;

        parents.push(currentParentFocusKey);
      }

      currentComponent = parentComponent;
    }

    const parentsToRemoveFlag = difference(
      this.parentsHavingFocusedChild,
      parents
    );
    const parentsToAddFlag = difference(
      parents,
      this.parentsHavingFocusedChild
    );

    forEach(parentsToRemoveFlag, (parentFocusKey) => {
      const parentComponent = this.focusableComponents[parentFocusKey];

      if (parentComponent && parentComponent.trackChildren) {
        parentComponent.onUpdateHasFocusedChild(false);
      }
      this.onIntermediateNodeBecameBlurred(parentFocusKey, focusDetails);
    });

    forEach(parentsToAddFlag, (parentFocusKey) => {
      const parentComponent = this.focusableComponents[parentFocusKey];

      if (parentComponent && parentComponent.trackChildren) {
        parentComponent.onUpdateHasFocusedChild(true);
      }
      this.onIntermediateNodeBecameFocused(parentFocusKey, focusDetails);
    });

    this.parentsHavingFocusedChild = parents;
  }

  updateParentsLastFocusedChild(focusKey: string) {
    let currentComponent = this.focusableComponents[focusKey];

    /**
     * Recursively iterate the tree up and update all the parent's lastFocusedChild
     */
    while (currentComponent) {
      const { parentFocusKey } = currentComponent;

      const parentComponent = this.focusableComponents[parentFocusKey];

      if (parentComponent) {
        this.setParentLastFocusedChildKey(
          parentComponent,
          currentComponent.focusKey
        );
      }

      currentComponent = parentComponent;
    }
  }

  setParentLastFocusedChildKey(component: FocusableComponent, focusKey: string) {
    if (component) {
      this.log(
        'saveLastFocusedChildKey',
        `${component.focusKey} lastFocusedChildKey set`,
        focusKey
      );

      // eslint-disable-next-line no-param-reassign
      component.lastFocusedChildKey = focusKey;
    }
  }

  updateAllLayouts() {
    forOwn(this.focusableComponents, (_component, focusKey) => {
      this.updateLayout(focusKey);
    });
  }

  updateLayout(focusKey: string) {
    const component = this.focusableComponents[focusKey];

    if (!component || component.layoutUpdated) {
      return;
    }

    const { node } = component;

    component.layout = {
      ...measureLayout(node),
      node
    };
  }

  /**
   * Checks whether the focusableComponent is actually participating in spatial navigation (in other words, is a
   * 'focusable' focusableComponent). Seems less confusing than calling it isFocusableFocusableComponent()
   */
  isParticipatingFocusableComponent(focusKey: string) {
    const component = this.getFocusableComponent(focusKey);
    return component?.focusable;
  }

  isParticipatingFocusableChild(focusKey: string) {
    return (
      this.isParticipatingFocusableComponent(focusKey) &&
      filter(
        this.focusableComponents,
        (component) => component.parentFocusKey === focusKey
      ).length === 0
    );
  }

  getFocusableComponents() {
    return this.focusableComponents;
  }

  getFocusableComponent(focusKey: string) {
    return this.focusableComponents[focusKey];
  }

  /**
   * Returns the current focus key
   */
  getCurrentFocusKey(): string {
    return this.focusKey;
  }

  getKeyMap() {
    return this.keyMap;
  }

  setKeyMap(keyMap: BackwardsCompatibleKeyMap) {
    this.keyMap = {
      ...this.getKeyMap(),
      ...normalizeKeyMap(keyMap)
    };
  }

  getEventType(keyCode: number) {
    return findKey(this.getKeyMap(), (codeList) => codeList.includes(keyCode));
  }

  log(functionName: string, debugString: string, ...rest: any[]) {
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log(
        `%c${functionName}%c${debugString}`,
        `background: ${
          DEBUG_FN_COLORS[this.logIndex % DEBUG_FN_COLORS.length]
        }; color: black; padding: 1px 5px;`,
        'background: #333; color: #BADA55; padding: 1px 5px;',
        ...rest
      );
    }
  }

  startDrawLayouts() {
    const draw = () => {
      requestAnimationFrame(() => {
        this.visualDebugger.clearLayouts();
        forOwn(this.focusableComponents, (component, focusKey) => {
          this.visualDebugger.drawLayout(
            component.layout,
            focusKey,
            component.parentFocusKey
          );
        });
        draw();
      });
    };

    draw();
  }

  drawComponentCorners(focusKey: string, color: string) {
    const component = this.focusableComponents[focusKey];
    const { layout } = component;
    if (layout) {
      const { left, top, width, height } = layout;
      const leftEdge = left;
      const topEdge = top;
      const rightEdge = leftEdge + width;
      const bottomEdge = topEdge + height;

      const corners = [
        { x: leftEdge, y: topEdge },
        { x: rightEdge, y: topEdge },
        { x: leftEdge, y: bottomEdge },
        { x: rightEdge, y: bottomEdge }
      ];

      corners.forEach((corner) => {
        this.visualDebugger.drawPoint(corner.x, corner.y, color, 6);
      });
    }
  }
}

/**
 * Export singleton
 */
/** @internal */
export const SpatialNavigation = new SpatialNavigationServiceClass();

export const { init, setThrottle, destroy, setKeyMap } = SpatialNavigation;

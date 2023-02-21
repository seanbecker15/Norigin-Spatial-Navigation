# TODO

List of things that have been identified as action items during the investigation of this library.

## Testing and performance
- It would be ideal to be able to test this library without opening a browser
- Generally, we just need to write a spec for this package
- In order to make some design decisions, we need to figure out a reliable way to measure performance

## Known issues
- The algorithm for finding the location of a node on a page is not trivial and is likely to be prone to bugs on old devices. There was also a change at some point to avoid waiting until the element is done animating (meh).
- The "layout" data structure is a bit confusing and does not give us everything we need to make a decision. The most useful data it provides is a slightly broken "left" and "top" which are supposed to (?) represent the x, y coordinates on the page.
- The "layout" data is not always accurate, sometimes it is improperly cached. It's called at weird times. We may want to investigate the cost of caching vs. recalculating and determine when we need to recalculate to avoid buggy behavior.
- The visual debugger is a poor representation because calculations are done all over to compensate for the unreliable "layout" function

## Improvements
- Give developers the ability to customize the spatial algorithm so we can run A/B tests in different parts (contexts) of the application (in progress)
  - Refactored the algorithm that deteremines whether "siblings" are considered focusable ✅
  - Need to refactor the algorithm that determines which valid sibling to focus on
  - Need to consider the data that is passed in to each algo
  - Need to expose both of these algorithms contextually (per parent)
  - Need to add tests for the exposed algorithms
- Visual debugger: Provide better insights on the next items that would be focused upon in every direction.
- Visual debugger: Help us debug this library by drawing items at more reliable times. Show corners / important locations of everything that is focusable on the screen so we can debug the node location easily
- Visual debugger is too manual. It really should be tightly coupled to the data model and it should not need to be implemented by each algorithm. Rather, we should be able to consume an algorithm and draw its effects (as a "dry run").
- It would be nice to make a tool that allows us to generate tests based on shapes and locations of the shapes on the screen
- Examples need to be improved upon and taken out of the source code folder. Debugging should be driven by .env file, i.e. not in source control
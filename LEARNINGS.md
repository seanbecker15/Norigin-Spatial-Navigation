# Learnings
Things I've learned...

I need a way to measure performance so I can make decisions about the helper library "document-offset".

The algorithm for finding the location of a node on a page is not trivial and is likely to be  prone to bugs on old devices. There was also a change at some point to avoid waiting until the element is done animating (meh).

The "layout" data structure is a bit confusing and does not give us everything we need to make a decision. The most useful data it provides is a slightly broken "left" and "top" which are supposed to (?) represent the x, y coordinates on the page.

The "layout" data is not always accurate, sometimes it is improperly cached. It's called at weird times.

The visual debugger is cool but it doesn't really give us meaningful information atm because calculations are done all over to compensate for the broken layout function.
- It would be cool to outline the corners of the things we would highlight in every direction
- It would be cool to have a mode that shows the corners of everything focusable on the screen so we can debug the node location easily (I guess this is just layout mode?)
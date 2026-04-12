# Right Swipe Exit (SillyTavern Extension)

## Features

- In chat view, swipe from left to right to leave current chat and return to home/character list.
- Anti-mistouch guard: swipe is ignored when gesture starts inside input or editor areas.

## Install

Put this folder into your SillyTavern extensions directory, then enable `Right Swipe Exit`.

## Back Action Order

1. Try known page functions if available.
2. Try known back/home buttons by selector.
3. Fallback to `history.back()`.

If it does not work on your specific ST build, share your version and I can adapt the selectors exactly.

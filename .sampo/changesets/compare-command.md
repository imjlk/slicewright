---
npm/slicewright: minor (Added)
---

`slicewright compare` checks several PNGs against each other. States of one element must share a size and slice mode, detected insets and content padding must agree within `--slack` pixels, and the largest insets on each side (`sharedInsets`) must fit every state. With `--kind set`, the pieces of a matching set are compared only by outline weight. The comparison is also exported as `compareSet`.

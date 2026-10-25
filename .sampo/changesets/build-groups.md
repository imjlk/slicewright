---
npm/slicewright: minor (Added)
---
Build manifests take `groups` of piece states: after normalizing, each group is compared as states, a mismatch fails the build without packing, and `sharedInsets: true` normalizes the states again with their shared insets. The build report lists the groups.

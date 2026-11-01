Style this so it looks and feels like a native Apple app (iOS/macOS, SwiftUI), following Apple's Human Interface Guidelines. Use plain CSS, no UI library.

Colors: put every color in CSS variables on :root using Apple's semantic system colors, then redefine them under @media (prefers-color-scheme: dark).
- Light: background #f2f2f7, surfaces #ffffff, text #000, secondary text rgba(60,60,67,.6), tertiary rgba(60,60,67,.3), separators rgba(60,60,67,.18), fills rgba(118,118,128,.12).
- Dark: background #000, surfaces #1c1c1e, raised #2c2c2e, text #fff, secondary rgba(235,235,245,.6), separators rgba(84,84,88,.6).
- Accents (light/dark): blue #007aff/#0a84ff, green #34c759/#30d158, orange #ff9500/#ff9f0a, red #ff3b30/#ff453a, indigo #5856d6/#5e5ce6. Blue is the one interactive color.

Type: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif (Inter as the fallback off Apple devices). 17px body, letter-spacing -0.022em, antialiased. Large titles 34px bold. Section headers 13px uppercase in secondary color. Captions 13px. Tabular numbers for stats.

Surfaces: rounded cards (12-14px radius) on the grouped background. Use 0.5px hairline separators instead of borders, inset so they start under the text. No gradients, no heavy shadows, no borders thicker than 0.5px.

Materials: sticky headers, menus and popovers are translucent and frosted: backdrop-filter: saturate(180%) blur(20-30px) over a 72-86% opaque background, with a hairline edge.

Controls:
- Buttons are plain blue text, or tinted pills (light blue background, blue text), dimming to 35% opacity when pressed.
- Segmented controls have a grey track and a white sliding thumb.
- Search fields are rounded grey pills with a magnifying glass.
- Touch targets are at least 44px.

Dialogs: centered alerts with a button row split by hairlines. The primary action is semibold; destructive actions are red. Sheets rise from the bottom with a Cancel / Title / Done bar. Confirmations are a small bottom-center pill ("✓ Saved").

Motion: one easing, cubic-bezier(.32,.72,0,1), at 0.2-0.35s. Menus pop in from scale .94. No bounce and no flashy hover effects.

Icons: thin inline SVG line icons (stroke about 2, round caps), SF Symbols style. No emoji.

Feel: calm, lots of whitespace, hierarchy carried by type size and weight, not color. Must look right in light and dark mode and at phone width (375px) with no horizontal scroll.

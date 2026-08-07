# Dataview format

Tasks written in Dataview inline-field syntax instead of emoji. Requires
flipping the Tasks plugin's **Task Format** setting to **Dataview** — see
`00 - README.md`.

- [ ] Plain todo task
- [/] In-progress task
- [x] Completed task  [completion:: 2026-06-10]
- [-] Cancelled task  [cancelled:: 2026-06-09]

## With common metadata

- [ ] Buy groceries  [priority:: high]  [due:: 2026-06-15] #errands
- [/] Write quarterly report  [priority:: highest]  [due:: 2026-06-12] #work #report
- [x] Ship release  [priority:: low]  [completion:: 2026-06-09] #work

## Drag-and-drop targets

Drop these into Done / Cancelled and confirm the date is written as a
`[completion:: ...]` / `[cancelled:: ...]` inline field (two leading spaces),
not an emoji.

- [ ] Drop me into Done
- [ ] Drop me into Cancelled
- [x] Drop me back to Todo  [completion:: 2026-06-01]

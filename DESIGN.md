# UYYM workspace design

## Direction

Mode: **Operate / Read**. A calm study desk with clear navigation and restrained information density. Identity comes from the supplied UYYM logo, deep blue and a small yellow accent. The learner's next useful action leads; administration prioritizes readable records and safe decisions.

Desktop: 240 px navigation rail, compact 72 px header, generous working area. The rail contains grouped role-specific navigation and profile/logout. At tablet/phone widths it becomes a keyboard-accessible dialog. Its home link remains available on phones. The public marketing header and footer stay outside authenticated workspaces.

Student home uses actual enrolled courses, explicit completed-lesson counts, resumable playback position, pending/revision homework, scheduled lessons and announcements. A lesson pairs the player with a curriculum on desktop. A native disclosure places the mobile curriculum before the player in both visual and keyboard order. Previous/next use actual lesson order. Player identity follows lesson ID, never language or theme.

Admin applications use a semantic table on desktop and labelled records on phones. Read-only details precede the existing approval workflow. Identity confirmation, pending states, revisions and role checks remain in the existing application logic.

## Tokens and components

`client/src/workspace.css` defines `--ws-*` semantic tokens for surfaces, ink, metadata, controls, selected navigation, success and warning. Light surfaces are cool white; dark surfaces are muted blue. Yellow actions use dark text. All role panels share the same typography, control sizes, borders and spacing.

Typography uses the installed Segoe UI family and system fallbacks. No external font request. Heading/body/label/metadata roles are distinct; Kazakh text is included in local fixtures. Working prose has a bounded line length, tables use tabular numerals, long values wrap.

`ui.tsx` supplies Button variants, Badge, PageHeader, Skeleton, authored SVG icons and WorkspaceNav. Existing native Input/Select/Textarea/Checkbox, management Dialog, Notice, Empty, Status and Pager are retained and styled through the same tokens. Content tabs, record/card/table, success/error notices and modal forms use this shared system; a second UI framework is unnecessary.

Buttons have primary, secondary, ghost, destructive, busy and disabled variants. Controls expose visible focus. Dialogs trap focus, support Escape and restore the trigger; busy dialogs retain their existing close guard. Mobile controls have comfortable hit targets. Theme colors change together without a text/background crossfade. Reduced-motion rules disable workspace motion.

## Delivery constraints

Workspace code and its 33 kB stylesheet load on demand. The public entry does not eagerly import role panels or the private player. The shell and authorized role chunks start together. Keep lazy component definitions at module scope.

Fresh summaries are derived from protected course responses, with at most three course requests in flight. Returning from a course refreshes the summary; failures leave a usable retry. A page open never counts as lesson completion.

No backend authorization, media buffering, heartbeat, Drive permission, device proof, credential or infrastructure behavior is redesigned. Real provider playback and production access need their own approved-session verification.

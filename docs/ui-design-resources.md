# UYYM interface refresh

Reviewed 2026-10-14. GitHub star counts are a snapshot, not a quality guarantee.

| Resource | Stars | Latest repository push | License | Use in this change |
| --- | ---: | --- | --- | --- |
| [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | 181,004 (repository) | 2026-10-09 | [Apache 2.0 for this skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/LICENSE.txt) | Subject-specific design planning and visual critique |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | 125,554 | 2026-10-13 | [MIT](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md) | Consistent form, button and surface patterns |
| [Radix Primitives](https://github.com/radix-ui/primitives) | 19,390 | 2026-10-13 | [MIT](https://github.com/radix-ui/primitives/blob/main/LICENSE) | Keyboard/focus/dialog accessibility reference |

Read the frontend-design instructions, shadcn README/CLI guidance, and Radix
[philosophy](https://github.com/radix-ui/primitives/blob/main/philosophy.md).
The shadcn init/add commands install dependencies and can rewrite configuration;
they were deliberately not run. No remote code or component library is installed
or copied. Existing React, Tailwind, SVG icons and dialog focus handling remain.

## Direction

Retain the owner's blue/yellow identity and mathematical study illustration.
Use the system Segoe UI Variable/Segoe UI family with Kazakh glyph support;
no font CDN or new font download. Light surfaces: #F4F7FC / #FFFFFF, ink
#142C50. Dark surfaces: #0C1525 / #142239, ink #EDF4FF. Brand accents:
#1D3E87 / #FFCD2B. Left-aligned copy, restrained cards, 44–54 px controls.

Homepage: readable introduction → subject cards with explicit enrollment action
→ study format → FAQ/contact. Remove decorative course numbering.
Account: home link → role/name → approved-browser status → section navigation
and working panel. Increase the previous 8–11 px metadata/action text to 12–16 px.
On mobile, forms and actions stack and the existing section selector replaces
the sidebar. Preserve the existing language/theme preferences and security gates.

The new styles are scoped to .uyym-ui and use a small semantic token set, loaded
after the existing styles. This keeps the behavioral change separate from the
existing backend, Auth, Drive and payment code. The style layer can be removed
without changing routes or data.

## Review limits

Visual role checks use local fixture identities and embedded PostgreSQL with
simulated remote Auth. They do not establish a real production owner login,
Drive playback, Safari/iPhone behavior or assistive-technology compatibility.
Native media controls and file dialogs retain the browser/OS language.

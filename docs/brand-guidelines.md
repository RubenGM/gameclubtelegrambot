# CAWA Girona Brand Guidelines

Version: 0.1  
Last reviewed: 2026-05-19  
Primary source: current public website at `https://www.cawagirona.com/`

## Purpose

These guidelines define a practical brand direction for CAWA Girona's integrated
bot website and admin panel. They are not a redesign of the existing WordPress
site. They preserve the club's recognizable identity while making it easier to
build a clean, accessible, configurable web experience inside
`gameclubtelegrambot.service`.

## Brand Essence

CAWA Girona is a local, multidisciplinary gaming club: wargames, role-playing,
board games, miniatures, tournaments, community and regular play.

The brand should feel:

- Local and welcoming.
- Club-first, not corporate.
- Enthusiastic about hobby culture without becoming chaotic.
- Practical and trustworthy for members, admins and new applicants.
- Proud of being a community of people with shared niche interests.

Suggested brand line:

> Club de juegos, rol y wargames en Girona.

Optional warmer variant:

> Tu mesa de juego en Girona.

Avoid making the brand sound like:

- A commercial board-game shop.
- A generic SaaS dashboard.
- A fantasy-themed parody.
- A tournament-only organization.

## Name and Identity

Preferred written form:

- `CAWA Girona`

Acceptable short form:

- `CAWA`

Avoid inconsistent casing such as `CaWa` in new UI unless reproducing a legacy
logo asset exactly. The current site uses mixed casing in places, but the new
web should normalize interface copy to `CAWA Girona` for readability.

## Audience

Primary audiences:

- Current members checking activities, catalog items, club information and
  feedback.
- Prospective members deciding whether to request access.
- Admins maintaining the bot, public content and operations.

Secondary audiences:

- Visitors looking for address/contact details.
- Groups interested in events or tournaments.
- People arriving from Telegram or shared links.

## Voice and Tone

The current site is direct, friendly and informal. Preserve that warmth, but
make new web copy clearer and more structured.

Use:

- Clear Spanish by default.
- Friendly, direct sentences.
- Practical headings: `Actividades`, `Catalogo`, `Alta como socio`,
  `Informacion del club`.
- Light humor only where it helps onboarding.
- Plain explanations for fees, access, benefits and expectations.

Avoid:

- Dense paragraphs for key actions.
- Excessively internal vocabulary on public pages.
- Jokes in destructive admin flows or security-sensitive screens.
- Copy that assumes the reader already knows how the club works.

Example public copy:

```text
CAWA Girona es un club de juegos, rol y wargames en Salt. Compartimos local,
mesas, actividades y catalogo para jugar con regularidad y conocer gente con
aficiones parecidas.
```

Example admin copy:

```text
Restaurar un backup puede sobrescribir datos actuales del bot. Revisa el archivo
y confirma la accion solo si tienes claro que quieres recuperar ese estado.
```

## Content Pillars

Use these pillars to organize the public web:

- **Comunidad:** miembros, nuevos socios, ambiente de club, participacion.
- **Juego:** wargames, rol, juegos de mesa, miniaturas, Blood Bowl y catalogo.
- **Local:** espacio fisico, mesas, horarios, direccion y acceso.
- **Actividad:** calendario, torneos, partidas, eventos y noticias.
- **Utilidad:** feedback, alta como socio, contacto, admin y operaciones.

## Visual Identity

### Current Assets

The current site uses:

- Logo: `LogoPeque.png`, PNG, 250 x 266.
- Favicon: `favicon.png`.
- Green background strip: `fondoVerde.png`, PNG, 1920 x 301.
- Content/news imagery for videos, games, Blood Bowl, contact and events.

For the new integrated site:

- Keep the logo as the default brand mark.
- Let admins replace logo and hero images from the panel.
- Use real club/game/table imagery when available.
- Do not use generic fantasy stock art as the main identity.
- Do not stretch the logo; keep aspect ratio.

### Logo Usage

Default use:

- Place the logo in the header or hero area.
- Keep clear space around it equal to at least 20% of logo width.
- On dark backgrounds, use the existing transparent PNG if it remains legible.
- On light backgrounds, prefer the original logo without filters.

Avoid:

- Recoloring the logo automatically.
- Cropping it into a circle unless a manually prepared variant exists.
- Using it as a low-opacity background texture.
- Placing it over busy photos without a solid or translucent support.

## Color System

The current WordPress CSS uses a deep green accent as the strongest brand color.
Use it as the base of the new system.

### Core Palette

```text
Brand green      #184B1F
Near black       #000000
Ink              #222222
Body text        #444444
Muted text       #6A6A6A
Line gray        #DEDEDE
Surface          #FFFFFF
Dark surface     #1A1A1A
Gold accent      #9E8C18
Action blue      #0041D4
```

### Recommended CSS Tokens

```css
:root {
  --cawa-brand: #184b1f;
  --cawa-brand-hover: #123918;
  --cawa-ink: #222222;
  --cawa-text: #444444;
  --cawa-muted: #6a6a6a;
  --cawa-line: #dedede;
  --cawa-surface: #ffffff;
  --cawa-surface-alt: #f6f7f4;
  --cawa-dark: #1a1a1a;
  --cawa-gold: #9e8c18;
  --cawa-action: #0041d4;
  --cawa-danger: #b42318;
}
```

### Usage Rules

- Use `#184B1F` for primary navigation, active states and main calls to action.
- Use black/ink for headings and admin chrome.
- Use white and off-white surfaces for content-heavy pages.
- Use gold sparingly for highlights, badges or club-flavored accents.
- Use blue only for system actions where the green could be confused with
  brand navigation.
- Use red only for destructive admin actions.

Avoid:

- Purple gradients.
- Overly beige or brown themes.
- One-color green-only screens.
- Low-contrast green text on dark backgrounds.

## Typography

The current site loads several Google fonts: Raleway, Barlow, Work Sans and
Roboto. Its CSS emphasizes Barlow for navigation/buttons and Roboto for body
text.

Recommended web stack:

```css
--font-heading: "Barlow", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-body: "Roboto", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-ui: "Barlow", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

If external fonts are not desirable inside the integrated bot service, use the
system fallback stack and keep the visual identity through color, spacing and
layout.

Typography rules:

- Headings should be confident, compact and easy to scan.
- Admin headings should be smaller and denser than public page heroes.
- Body copy should use normal letter spacing. Do not copy the current negative
  letter-spacing globally into the new app.
- Buttons and labels may use medium weight.
- Avoid all-caps paragraphs. Reserve uppercase for small labels or badges.

## Layout Principles

### Public Web

The public website should prioritize quick orientation:

- What is CAWA?
- What can I do here?
- What activities are coming up?
- How do I join?
- How do I contact the club?

Recommended homepage structure:

- Header with logo, public navigation and admin link.
- Hero with club name, concise value proposition and primary actions.
- Activity preview.
- Catalog preview.
- Club information block.
- Join/contact/feedback calls to action.

Avoid a marketing-heavy landing page. The first screen should already expose
real club functionality.

### Admin Panel

The admin panel is operational software. It should be calm, dense and scannable:

- Start with a dashboard, not destructive tools.
- Group features by domain.
- Use clear status cards only for top-level metrics.
- Keep backup/restore/token/service controls in dedicated sections.
- Require explicit confirmation for destructive actions.

Avoid:

- Oversized hero sections in admin.
- Decorative nested cards.
- Putting restore/delete buttons in the primary dashboard.
- UI text that explains obvious UI mechanics instead of the real impact.

## Components

### Buttons

Primary:

- Green background, white text.
- Used for safe primary actions: save, submit, open, view.

Secondary:

- White or neutral surface, ink text, gray border.
- Used for navigation and non-primary actions.

Danger:

- Red background or red outlined button.
- Used only for destructive actions.
- Pair with confirmation text.

### Navigation

Public navigation:

- Inicio
- Actividades
- Catalogo
- Club
- Alta como socio
- Feedback
- Admin

Admin navigation:

- Dashboard
- Web publica
- Actividades
- Catalogo
- Socios
- Feedback
- Altas
- Feeds
- Backups
- Servicio
- Configuracion
- Recursos avanzados

### Forms

- Keep labels explicit.
- Show validation errors next to the affected field.
- Preserve submitted values after validation failures.
- Use helper text for consequences, not for obvious instructions.
- Public forms should be short.
- Admin destructive forms should include a confirmation field when impact is
  high.

## Imagery

Use:

- Real photos from the club, tables, miniatures, games, events and tournaments.
- Existing YouTube/game thumbnails only where they represent actual content.
- Crops that show playable objects clearly.

Avoid:

- Generic stock photos of board games.
- Dark, blurred backgrounds that hide the actual club.
- Fantasy art that implies a single game genre.
- AI-generated imagery as the main proof of what the club is.

Recommended aspect ratios:

- Hero image: 16:9 or wide banner.
- Section cards: 4:3 or 3:2.
- Logo: original transparent PNG aspect ratio.

## Theme Model

The integrated web should support selectable CSS themes, but every theme should
preserve the same CAWA identity.

Initial themes:

- `classic`: white surface, green navigation, black headings.
- `club-dark`: dark admin/public variant with green accents.
- `tabletop`: warmer public theme with off-white surfaces and gold highlights.
- `high-contrast`: accessibility-first theme with stronger borders and larger
  contrast.

Each theme must define:

- Background.
- Surface.
- Text.
- Muted text.
- Border.
- Brand.
- Brand hover.
- Action.
- Danger.
- Focus ring.

Theme names must be allowlisted. Never load arbitrary CSS filenames from user
input.

## Accessibility and Usability

- All text must meet WCAG AA contrast.
- Every form input must have a visible label.
- Buttons must describe the action, not only the object.
- Focus states must be visible.
- Destructive actions must not rely on color alone.
- Public pages should work without JavaScript.
- Admin pages should keep server-rendered fallbacks for confirmations.
- Mobile navigation must not hide core routes.

## Security-Sensitive Brand Rules

Because the admin panel controls the bot, brand consistency includes operational
clarity:

- Never make dangerous actions look playful.
- Never hide the consequence of restore/delete/token/service actions.
- Never expose tokens, hashes, internal paths or private chat IDs on public
  pages.
- Admin warnings should be sober and specific.
- Confirmation pages should name the object being changed.

## Copy Rules for Joining

The current public site explains membership around participation, maintaining
the rented local space and affordability. Preserve this framing, but keep any
fees configurable because published amounts may change.

Public join page should include:

- Who can apply.
- What membership enables.
- Current fee or "cuota actual", editable from admin.
- Expected participation.
- Contact or Telegram next step.
- Privacy note for submitted data.

Avoid hardcoding current member count, square meters or fee in code. These can
appear as configurable content if admins want to keep them updated.

## Implementation Notes for the Bot Web

- Store brand settings with the public web settings, not in CSS constants only.
- Seed defaults from this document:
  - `theme`: `classic`
  - `brandName`: `CAWA Girona`
  - `headline`: `Club de juegos, rol y wargames en Girona`
  - `primaryColor`: `#184b1f`
  - `logoAsset`: existing logo if imported by admin
- Keep theme tokens in `src/http/http-theme.ts`.
- Keep configurable public content in `app_metadata` or a dedicated web settings
  table.
- Use `docs/brand-guidelines.md` as the reference when adding future public
  sections or admin screens.

## Source Notes

Current website observations used for this version:

- Public navigation includes club pages, calendar, contact, role-playing,
  wargames, board games and Blood Bowl.
- The join page describes CAWA as a club with around 80 members, a rented space
  of 130 square meters, shared activities and a monthly fee, but these values
  should be treated as editable public content.
- The contact page lists Carrer Major 306, Salt, email and WhatsApp contact.
- The homepage groups the club around role-playing, wargames and board games,
  plus news/video content and external community links.
- The current CSS uses `#184b1f` as the strongest green accent and Barlow/Roboto
  as practical UI/body fonts.

Sources:

- `https://www.cawagirona.com/`
- `https://www.cawagirona.com/about-2/cawa-girona/`
- `https://www.cawagirona.com/about-2/calendario/`
- `https://www.cawagirona.com/contactar/`
- `https://www.cawagirona.com/wp-content/themes/bridge/css/style_dynamic.css?ver=1716297277`
- `https://www.cawagirona.com/wp-content/uploads/2019/12/LogoPeque.png`
- `https://www.cawagirona.com/wp-content/uploads/2020/02/fondoVerde.png`

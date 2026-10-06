# Peoplebox design system

Built for this Nova prototype. The colors come from the logo file on the desktop, sampled from the pixels, not from a guess.

| Token | Hex | Where it shows up in the logo |
| --- | --- | --- |
| Lilac ground | `#F0ECF9` | The field behind the mark |
| Violet | `#5E2AB2` | The Peoplebox.ai wordmark |
| Orange | `#F9891D` | The pretzel mark |

Ink `#24183A` and muted `#655C78` are darker and softer readings of that same violet, so body text stays on the brand without inventing a second palette.

## Type

Outfit for titles. Source Sans 3 for everything you read in a paragraph or a chat. Both are plain geometric sans faces, close to the wordmark, and easy to read at chat size. If the font host is blocked, Segoe UI takes over.

## Logo

Use `public/brand/peoplebox-lockup.png` or `public/brand/peoplebox-mark.png`. Do not redraw the wordmark in CSS, do not change the orange, and do not use the pretzel as a bullet or a button icon. Give it room. On this site the header sits on the same lilac as the logo field.

## Pieces

The screen uses a small set, all in `public/app.css`, all on these tokens:

- Primary button: violet fill, white label
- Quiet button: white fill, violet text, lilac border
- Card: white, 16px radius, soft violet shadow
- Chat from Nova: white bubble, orange tick
- Chat from the candidate: violet bubble, white text
- Pills: lilac for waiting, violet for the current goal, orange for a medium score

Orange is the accent, not the main action. The main action stays violet, same as the wordmark.

## Voice of the copy

Short sentences. Say who is speaking and what happens next. No hype, no "awesome", no stacked questions in a label. The product is a phone screen. The interface should sound like the same person who wrote the prompt.

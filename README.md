# FroYo Macro HMI (web demo)

An interactive web version of the FroYo Macro vending machine HMI. It runs
entirely in the browser, so it works on GitHub Pages and offline from a
laptop during a presentation.

Customers pick flavors and toppings, set their macros (or tap **Balance for
me**), and the machine works out how many grams of each ingredient to
dispense. If the macros can't be made, it offers the closest achievable cup
or a trip back to change ingredients or macros. The price is based on the
grams of each ingredient used.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page |
| `config.js` | All text, colours, ingredients, nutrition, prices and timings. Edit this one. |
| `engine.js` | Feasibility engine (port of `macro.py`) with a built in linear programming solver |
| `app.js` | The screens and flow (port of `HMI.py`) |
| `style.css` | Look and layout |

## Put it on GitHub Pages

1. On GitHub, create a new public repository, for example `froyo-hmi`.
2. Upload the five files above to the root of the repository
   (**Add file > Upload files**, drag them in, **Commit changes**).
3. Go to **Settings > Pages**. Under **Build and deployment**, set
   **Source** to *Deploy from a branch*, pick the `main` branch and the
   `/ (root)` folder, then **Save**.
4. After a minute or so the demo is live at
   `https://<your-username>.github.io/froyo-hmi/`.

To change anything later, edit `config.js` on GitHub and commit. The site
updates by itself within a minute or two.

## Presenting

- Press **F** (or the Fullscreen button) to fill the screen. The kiosk
  scales to any display.
- Press **R** to restart from the idle screen.
- It also works with no internet: download the files and open
  `index.html` in a browser.

## How the engine decides

- Calories are hit exactly, protein is a minimum, fat is a maximum.
- Carbs are a maximum, unless you ask for more than the ingredients give by
  default, then they're hit exactly.
- Each macro counts as hit within about half a screen step.
- Multiple flavors stay within `flavor_split_tolerance` of an even split.
- When a request is impossible, it finds the cup that bends the macros
  the least.

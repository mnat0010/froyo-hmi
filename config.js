// ---------------------------------------------------------------------------
// FroYo HMI config (web version)
// Edit this file to change any text, colours, ingredients or prices.
// Same settings as config.yaml in the Python version.
// Colours are [R, G, B], each 0-255.
// ---------------------------------------------------------------------------

window.FROYO_CONFIG = {

  window: {
    width: 800,
    height: 480,
    title: "FroYo Macro - HMI Demo"
  },

  colors: {
    background: [255, 240, 250],
    text: [30, 30, 30],
    text_muted: [140, 120, 125],
    primary: [230, 110, 150],
    primary_dark: [190, 80, 120],
    accent: [240, 200, 210],
    teal: [70, 180, 160],
    card: [255, 255, 255],
    border: [235, 210, 215],
    selected_tint: [226, 75, 74]
  },

  text: {
    fonts: {
      font: "Arial, Helvetica, sans-serif",
      title: 40,
      h2: 24,
      body: 18,
      small: 14,
      btn: 20,
      btn_sub: 14
    },
    idle: {
      title: "FroYo Macro",
      subtitle: "Touch to start",
      circle_color: [240, 200, 210]
    },
    flavor: { title: "FLAVORS", subtitle: "Choose your Flavors" },
    toppings: { title: "TOPPINGS", subtitle: "Optional - tap any you like" },
    macros: { title: "MACROS", subtitle: "Choose your Macros" },
    summary: { title: "YOUR CUP", subtitle: "Here's what goes in" },
    check: { title: "ADJUST", subtitle: "We can't make that exactly" },
    payment: { title: "PAYMENT", subtitle: "Simulated tap to pay" },
    dispensing: { title: "DISPENSING", subtitle: "Preparing your order..." },
    done: { title: "DONE", subtitle: "Enjoy your froyo!" }
  },

  // -------------------------------------------------------------------------
  // INGREDIENT LIBRARY
  //   price_per_gram       what the customer pays per gram dispensed
  //   max_grams            most the machine will put in one cup
  //   nutrition_per_100g   calories (kcal), protein, carbs, fat (g)
  // -------------------------------------------------------------------------

  flavors: [
    {
      name: "Vanilla", color: [250, 240, 210],
      price_per_gram: 0.025, max_grams: 400,
      nutrition_per_100g: { calories: 159, protein: 4.0, carbs: 24.2, fat: 5.6 }
    },
    {
      name: "Chocolate", color: [110, 70, 55],
      price_per_gram: 0.027, max_grams: 400,
      nutrition_per_100g: { calories: 160, protein: 4.5, carbs: 26.0, fat: 4.8 }
    },
    {
      name: "Strawberry", color: [240, 130, 150],
      price_per_gram: 0.026, max_grams: 400,
      nutrition_per_100g: { calories: 140, protein: 3.5, carbs: 25.0, fat: 3.0 }
    }
  ],

  toppings: [
    {
      name: "Sprinkles", price_per_gram: 0.040, max_grams: 20,
      nutrition_per_100g: { calories: 470, protein: 1.5, carbs: 85.0, fat: 13.0 }
    },
    {
      name: "Choc Chips", price_per_gram: 0.050, max_grams: 30,
      nutrition_per_100g: { calories: 480, protein: 4.2, carbs: 63.0, fat: 30.0 }
    },
    {
      name: "Fresh Fruit", price_per_gram: 0.020, max_grams: 150,
      nutrition_per_100g: { calories: 50, protein: 0.7, carbs: 12.5, fat: 0.2 }
    },
    {
      name: "Protein Powder", price_per_gram: 0.060, max_grams: 50,
      nutrition_per_100g: { calories: 378, protein: 78.1, carbs: 8.1, fat: 3.4 }
    },
    {
      name: "Granola", price_per_gram: 0.035, max_grams: 60,
      nutrition_per_100g: { calories: 470, protein: 10.0, carbs: 64.0, fat: 20.0 }
    }
  ],

  // Smallest portions the machine will dispense
  portions: {
    min_total_froyo_grams: 100,   // froyo in every cup, across all flavors
    min_flavor_grams: 30,         // each flavor that was picked
    min_topping_grams: 5,         // each topping that was picked
    flavor_split_tolerance: 0.10  // each flavor within 10% of an even share
  },

  // "Balance for me" fills in what the picked ingredients naturally give
  // at this many calories, rounded to the steps below
  balance: {
    calories: 300
  },

  macros: [
    { name: "Carbohydrates", unit: "g", default: 30, min: 0, max: 80, step: 5 },
    { name: "Protein", unit: "g", default: 5, min: 0, max: 30, step: 1 },
    { name: "Fats", unit: "g", default: 3, min: 0, max: 25, step: 1 },
    { name: "Calories", unit: "kcal", default: 200, min: 0, max: 600, step: 10 }
  ],

  // Simulated machine behaviour after payment
  dispensing: {
    stations: 4,                   // a random collection station 1 to N is picked
    mass_variation_percent: 3,     // each ingredient lands within this % of its target...
    mass_variation_min_grams: 0.5  // ...or this many grams, whichever is bigger
  },

  timing: {
    idle_timeout_seconds: 45,
    dispense_duration_seconds: 5,
    sleep_after_done_seconds: 2,
    return_home_seconds: 15
  },

  pricing: {
    currency: "$",
    // Cost = grams of each ingredient x its price_per_gram, plus this flat fee
    cup_fee: 0.00
  }
};

let SYMBOLS = [];

// Fetch indices from NSE
export async function loadSymbols() {
  try {
    const res = await fetch("https://www.nseindia.com/api/allIndices", {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    });

    const data = await res.json();

    SYMBOLS = data.data.map(item => ({
      name: item.index.toUpperCase(),
      tv: `NSE:${item.index.replace(/\s+/g, "").toUpperCase()}-INDEX`
    }));

    localStorage.setItem("symbols", JSON.stringify(SYMBOLS));
    localStorage.setItem("symbols_last_updated", Date.now());

  } catch (err) {
    console.error("Symbol fetch failed, using cache", err);
    SYMBOLS = JSON.parse(localStorage.getItem("symbols")) || [];
  }
}

// Convert user input → correct symbol
export function resolveSymbol(input) {
  input = input.toUpperCase().trim();

  const match = SYMBOLS.find(s =>
    s.name.includes(input)
  );

  return match ? match.tv : null;
}

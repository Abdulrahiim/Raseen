const STATUS_CLASS = { "real": "is-real", "real code": "is-real", "designed": "is-designed", "representative": "is-designed", "simulated": "is-sim", "indicative": "is-designed" };

export async function mount(root, { store }) {
  const status = store.get().status;
  const panel = document.createElement("section"); panel.className = "panel";
  const head = document.createElement("div"); head.className = "panel-head";
  head.innerHTML = `<h2>What is real, what is designed, what is simulated</h2>`;
  const note = document.createElement("p"); note.className = "panel-note"; note.textContent = status?.disclaimer ?? "";
  const table = document.createElement("table"); table.className = "table";
  table.innerHTML = `<thead><tr><th>Item</th><th>Status</th><th>Note</th></tr></thead>`;
  const body = document.createElement("tbody");
  for (const row of status?.what_is_real ?? []) {
    const tr = document.createElement("tr");
    const item = document.createElement("td"); item.textContent = row.item;
    const st = document.createElement("td"); const pill = document.createElement("span"); pill.className = `status-pill ${STATUS_CLASS[row.status] ?? ""}`; pill.textContent = row.status; st.append(pill);
    const n = document.createElement("td"); n.textContent = row.note;
    tr.append(item, st, n); body.append(tr);
  }
  table.append(body);
  panel.append(head, note, table);
  root.append(panel);
}
export function unmount() {}

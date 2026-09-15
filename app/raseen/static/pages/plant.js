export async function mount(root) {
  const panel = document.createElement("section"); panel.className = "panel";
  panel.innerHTML = `<div class="panel-head"><h2>Plant</h2></div><p class="empty">Coming in a later task.</p>`;
  root.append(panel);
}
export function unmount() {}

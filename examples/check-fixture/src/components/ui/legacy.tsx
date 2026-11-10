// A compatibility copy that duplicates ui/button.
export function Button({ children }: { children?: unknown }) {
  return <button className="legacy">{children as never}</button>;
}

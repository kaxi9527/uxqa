function Button({ label }: { label: string }) {
  return <span style={{ color: "#333333", padding: 10 }}>{label}</span>;
}

export function Settings() {
  return <Button label="保存" />;
}

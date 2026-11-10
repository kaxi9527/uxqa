export function Stats() {
  return (
    <section>
      <header className="flex items-center gap-2"><h2 className="text-lg font-medium">本月</h2><span className="text-sm text-muted-foreground">截至今天</span></header>
      <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">订单</p><p className="text-2xl font-semibold">128</p><span className="text-xs text-green-600">+12%</span></div>
      <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">收入</p><p className="text-2xl font-semibold">¥9,800</p><span className="text-xs text-green-600">+8%</span></div>
    </section>
  );
}

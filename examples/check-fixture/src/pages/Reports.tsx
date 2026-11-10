export function Reports() {
  return (
    <section>
      <header className="flex items-center gap-2"><h2 className="text-lg font-medium">报表</h2><span className="text-sm text-muted-foreground">按周</span></header>
      <header className="flex items-center gap-2"><h2 className="text-lg font-medium">导出</h2><span className="text-sm text-muted-foreground">CSV</span></header>
      <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">访客</p><p className="text-2xl font-semibold">3,200</p><span className="text-xs text-green-600">+3%</span></div>
      <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">退款</p><p className="text-2xl font-semibold">6</p><span className="text-xs text-red-600">-2%</span></div>
    </section>
  );
}

import { Button } from '@example/design-system';

export function EventActions() {
  const label = 'Save event';
  const active = true;
  const size = 'medium';
  return (
    <section>
      <h2>Event actions</h2>
      <p>Review the current record before saving.</p>
      <Button size={size} disabled={!active}>{label}</Button>
    </section>
  );
}

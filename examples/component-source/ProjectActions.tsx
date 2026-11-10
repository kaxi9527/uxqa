import { Button } from '@example/design-system';

export function ProjectActions() {
  const label = 'Save project';
  const active = true;
  const size = 'medium';
  return (
    <section>
      <h2>Project actions</h2>
      <p>Review the current record before saving.</p>
      <Button size={size} disabled={!active}>{label}</Button>
    </section>
  );
}

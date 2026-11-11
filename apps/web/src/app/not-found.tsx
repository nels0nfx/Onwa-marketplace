import { ButtonLink } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <div className="container page-narrow stack">
      <h1>Page not found</h1>
      <p className="muted">That page does not exist, or you do not have access to it.</p>
      <div><ButtonLink href="/">Back to home</ButtonLink></div>
    </div>
  );
}

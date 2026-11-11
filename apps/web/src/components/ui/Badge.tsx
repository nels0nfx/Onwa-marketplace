export function Badge({ children, staff }: { children: React.ReactNode; staff?: boolean }) {
  return <span className={staff ? 'badge badge-staff' : 'badge'}>{children}</span>;
}

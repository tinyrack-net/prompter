import { redirect } from 'react-router';

export function loader() {
  return redirect('/');
}

export default function NotFound() {
  return null;
}

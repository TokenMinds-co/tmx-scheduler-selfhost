import { redirect } from 'next/navigation';

// The queue is the screen an operator actually works in, so it is the home.
export default function Home() {
  redirect('/queue');
}

import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'SongYUE2 · 나만의 음악 작업실', description: '가사 한 줄에서 시작하는 로컬 음악 작업실.', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" className="dark"><body>{children}</body></html>;
}

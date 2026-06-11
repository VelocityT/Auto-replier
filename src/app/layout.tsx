import "./globals.css";

export const metadata = {
  title: "Auto Replier — Review Queue",
  description: "Pending comments and reviews waiting for human approval",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

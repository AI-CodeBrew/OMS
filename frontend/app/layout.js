import "./globals.css";

export const metadata = {
  title: "OMS",
  description: "Multi-tenant Order Management System",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

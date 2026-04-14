import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Quiz Prompt Builder",
  description:
    "Generate robust external-AI quiz prompts from PDFs, then validate and edit returned JSON quizzes."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

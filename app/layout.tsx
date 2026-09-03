import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "红序｜小红书个人 IP 运营与素材系统",
  description: "独立素材管理、个人 IP 内容审查、发布、监控和竞品分析工作台。",
  openGraph: {
    title: "红序｜从素材、作图到发布，一站完成",
    description: "小红书素材、图片设计、草稿审查和发布排期的一站式工作台。",
    type: "website",
    images: [{ url: "/og.png", width: 1728, height: 909, alt: "红序图片设计与发布工作流" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "红序｜从素材、作图到发布，一站完成",
    description: "小红书素材、图片设计、草稿审查和发布排期的一站式工作台。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

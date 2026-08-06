import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "红序｜小红书双业务运营系统",
  description: "信息流矩阵与个人 IP 的内容审查、发布、监控和竞品分析工作台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

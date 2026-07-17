# 程式

本目錄保存格式、來源、期限、狀態和連結檢查工具。原創程式碼採 MIT License 授權。

## 內容驗證

在專案根目錄執行：

```bash
npm install
npm run validate
```

驗證器會掃描 `內容/` 與 `來源/` 下除 README 以外的 Markdown，檢查 Front Matter、Schema、重複 ID、來源引用及活動時間順序。

-- 0002_issue_title.sql —— 记录 Issue 标题，供控制台与 /issues 指令展示

ALTER TABLE issue_map ADD COLUMN title TEXT;

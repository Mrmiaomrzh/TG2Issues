-- 演示数据：只在本地/测试库使用，用来预览控制台
-- 用法：npm run db:demo    清空：npm run db:clear
DELETE FROM issue_map;
DELETE FROM dead_letters;
DELETE FROM processed_updates;
DELETE FROM rate_events;
INSERT INTO issue_map (chat_id,message_id,repo,issue_number,issue_url,sender_id,thread_id,status,created_at,title) VALUES
 (-1001234567890,4201,'acme/web',128,'https://github.com/acme/web/issues/128',901,7,'done',strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 hours'),'结账页点击下单后白屏'),
 (-1001234567890,4198,'acme/web',127,'https://github.com/acme/web/issues/127',913,7,'done',strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 hours'),'希望支持导出 CSV（含中文表头）'),
 (-1001234567890,4180,'acme/web',126,'https://github.com/acme/web/issues/126',908,7,'done',strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days'),'移动端搜索框被键盘遮挡'),
 (-1001234567890,4172,'acme/web',125,'https://github.com/acme/web/issues/125',902,7,'done',strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'),'夜间模式对比度太低，看不清次要文字'),
 (-1001234567890,4160,'acme/web',124,'https://github.com/acme/web/issues/124',917,7,'done',strftime('%Y-%m-%dT%H:%M:%SZ','now','-5 days'),'登录验证码收不到短信'),
 (-1001234567890,4152,'acme/web',123,'https://github.com/acme/web/issues/123',921,7,'done',strftime('%Y-%m-%dT%H:%M:%SZ','now','-8 days'),'上传头像后没有立即刷新'),
 (-1001234567890,4140,'acme/web',NULL,NULL,905,7,'failed',strftime('%Y-%m-%dT%H:%M:%SZ','now','-9 hours'),'支付回调偶发超时'),
 (-1001234567890,4131,'acme/web',122,'https://github.com/acme/web/issues/122',933,7,'done',strftime('%Y-%m-%dT%H:%M:%SZ','now','-11 days'),'文档里的示例命令缺少引号'),
 (-1001234567890,4120,'acme/web',NULL,NULL,941,7,'pending',strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 minutes'),'刚提交的一条反馈，正在处理中');
INSERT INTO dead_letters (payload,error,attempts,created_at) VALUES
 ('{"update_id":778812,"message":{"message_id":4140,"message_thread_id":7,"text":"支付回调偶发超时","chat":{"id":-1001234567890,"type":"supergroup","title":"产品反馈"}}}','GitHub 403 /repos/acme/web/issues -> Resource not accessible by personal access token',2,strftime('%Y-%m-%dT%H:%M:%SZ','now','-9 hours'));
INSERT INTO processed_updates (update_id,chat_id,created_at) VALUES (778801,-1001234567890,strftime('%Y-%m-%dT%H:%M:%SZ','now'));

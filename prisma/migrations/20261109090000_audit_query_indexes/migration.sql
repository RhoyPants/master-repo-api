-- Query indexes only: existing audit tables/data remain compatible without this migration.
CREATE NONCLUSTERED INDEX [AuditLogs_StartedAt_Id_idx]
ON [dbo].[AuditLogs] ([StartedAt] DESC, [Id] DESC);

CREATE NONCLUSTERED INDEX [AuditItems_Run_Status_Action_Id_idx]
ON [dbo].[AuditTransactionItems] ([AuditLogId], [Status], [Action], [Id]);

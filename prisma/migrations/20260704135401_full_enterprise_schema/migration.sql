/*
  Warnings:

  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
BEGIN TRY

BEGIN TRAN;

-- DropTable
DROP TABLE [dbo].[User];

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] INT NOT NULL IDENTITY(1,1),
    [email] VARCHAR(255) NOT NULL,
    [name] VARCHAR(255) NOT NULL,
    [password_hash] VARCHAR(255),
    [role] VARCHAR(20) NOT NULL,
    [user_type] VARCHAR(20) NOT NULL,
    [auth_type] VARCHAR(20) NOT NULL,
    [sso_id] VARCHAR(255),
    [sso_provider] VARCHAR(50),
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [users_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[Uoms] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [UomCode] NVARCHAR(20) NOT NULL,
    [UomName] NVARCHAR(100) NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [Uoms_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [UpdatedAt] DATETIME,
    CONSTRAINT [Uoms_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [Uoms_UomCode_key] UNIQUE NONCLUSTERED ([UomCode])
);

-- CreateTable
CREATE TABLE [dbo].[ItemClasses] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [ItmsGrpCod] NVARCHAR(50) NOT NULL,
    [Initials] NVARCHAR(50) NOT NULL,
    [ItmsGrpNam] NVARCHAR(150) NOT NULL,
    [IsActive] BIT NOT NULL CONSTRAINT [ItemClasses_IsActive_df] DEFAULT 1,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [ItemClasses_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [UpdatedAt] DATETIME,
    CONSTRAINT [ItemClasses_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [ItemClasses_ItmsGrpCod_key] UNIQUE NONCLUSTERED ([ItmsGrpCod])
);

-- CreateTable
CREATE TABLE [dbo].[ItemGroups] (
    [ItemGroupID] NVARCHAR(50) NOT NULL,
    [Initials] NVARCHAR(50) NOT NULL,
    [Name] NVARCHAR(150) NOT NULL,
    [ItemClassCode] NVARCHAR(50) NOT NULL,
    [ItemClass] NVARCHAR(150) NOT NULL,
    [Category] NVARCHAR(50) NOT NULL,
    [IsActive] BIT NOT NULL CONSTRAINT [ItemGroups_IsActive_df] DEFAULT 1,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [ItemGroups_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [UpdatedAt] DATETIME,
    CONSTRAINT [ItemGroups_pkey] PRIMARY KEY CLUSTERED ([ItemGroupID])
);

-- CreateTable
CREATE TABLE [dbo].[Warehouses] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [WhCode] NVARCHAR(20) NOT NULL,
    [WhName] NVARCHAR(100) NOT NULL,
    [Address] NVARCHAR(255),
    [IsActive] BIT NOT NULL CONSTRAINT [Warehouses_IsActive_df] DEFAULT 1,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [Warehouses_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [UpdatedAt] DATETIME,
    CONSTRAINT [Warehouses_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [Warehouses_WhCode_key] UNIQUE NONCLUSTERED ([WhCode])
);

-- CreateTable
CREATE TABLE [dbo].[PaymentTerms] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [GroupNum] INT NOT NULL,
    [PaymentTerm] NVARCHAR(100) NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [PaymentTerms_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [UpdatedAt] DATETIME,
    CONSTRAINT [PaymentTerms_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[TaxGroups] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [TaxCode] NVARCHAR(50) NOT NULL,
    [TaxName] NVARCHAR(100) NOT NULL,
    [TaxRate] DECIMAL(9,4) NOT NULL,
    [Category] NVARCHAR(50) NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [TaxGroups_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [UpdatedAt] DATETIME,
    CONSTRAINT [TaxGroups_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [TaxGroups_TaxCode_key] UNIQUE NONCLUSTERED ([TaxCode])
);

-- CreateTable
CREATE TABLE [dbo].[Vendors] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [VendorCode] NVARCHAR(20) NOT NULL,
    [VendorName] NVARCHAR(150) NOT NULL,
    [ContactNumber] NVARCHAR(50),
    [Email] NVARCHAR(100),
    [Address] NVARCHAR(255),
    [TaxIDNo] NVARCHAR(50),
    [PaymentTerms] NVARCHAR(100),
    [TaxStatus] BIT NOT NULL,
    [WTLiable] BIT NOT NULL,
    [WTCode] NVARCHAR(20),
    [WTName] NVARCHAR(100),
    [WTRate] DECIMAL(9,4),
    [IsActive] BIT NOT NULL CONSTRAINT [Vendors_IsActive_df] DEFAULT 1,
    [Entity] NVARCHAR(20) NOT NULL,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [Vendors_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [UpdatedAt] DATETIME,
    CONSTRAINT [Vendors_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[Items] (
    [ItemCode] NVARCHAR(50) NOT NULL,
    [ItemDescription] NVARCHAR(255) NOT NULL,
    [IsActive] BIT NOT NULL CONSTRAINT [Items_IsActive_df] DEFAULT 1,
    [Category] NVARCHAR(50) NOT NULL,
    [ItemClassCode] NVARCHAR(50),
    [ItemClassName] NVARCHAR(150),
    [UOM_ID] INT,
    [UOM] NVARCHAR(50),
    [LeadTime] INT NOT NULL CONSTRAINT [Items_LeadTime_df] DEFAULT 0,
    [IsWHInventory] BIT NOT NULL CONSTRAINT [Items_IsWHInventory_df] DEFAULT 0,
    [IsSalesInventory] BIT NOT NULL CONSTRAINT [Items_IsSalesInventory_df] DEFAULT 0,
    [IsPurchaseInventory] BIT NOT NULL CONSTRAINT [Items_IsPurchaseInventory_df] DEFAULT 0,
    [ItemGroupName] NVARCHAR(150),
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [Items_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [UpdatedAt] DATETIME,
    CONSTRAINT [Items_pkey] PRIMARY KEY CLUSTERED ([ItemCode])
);

-- CreateTable
CREATE TABLE [dbo].[PurchaseOrders] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [PoNumber] NVARCHAR(50) NOT NULL,
    [Pin] NVARCHAR(50),
    [Company] NVARCHAR(50) NOT NULL,
    [VendorName] NVARCHAR(200) NOT NULL,
    [VendorCode] NVARCHAR(50) NOT NULL,
    [Project] NVARCHAR(100) NOT NULL,
    [Entity] NVARCHAR(50) NOT NULL,
    [DeliveryDate] DATETIME NOT NULL,
    [WarehouseCode] NVARCHAR(50) NOT NULL,
    [WarehouseName] NVARCHAR(200) NOT NULL,
    [IsWarehouse] BIT NOT NULL,
    [Status] NVARCHAR(50) NOT NULL,
    [aims_status] NVARCHAR(20),
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [PurchaseOrders_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PurchaseOrders_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [PurchaseOrders_PoNumber_key] UNIQUE NONCLUSTERED ([PoNumber])
);

-- CreateTable
CREATE TABLE [dbo].[PurchaseOrderLines] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [PoNumber] NVARCHAR(50) NOT NULL,
    [ItemCode] NVARCHAR(50) NOT NULL,
    [Description] NVARCHAR(max) NOT NULL,
    [Quantity] DECIMAL(18,6) NOT NULL,
    [Uom] NVARCHAR(20) NOT NULL,
    [VendorPrice] DECIMAL(18,6) NOT NULL,
    CONSTRAINT [PurchaseOrderLines_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[PurchaseRequests] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [Company] NVARCHAR(20) NOT NULL,
    [PrRefNo] NVARCHAR(50) NOT NULL,
    [PIN] NVARCHAR(50) NOT NULL,
    [RequestDate] DATE NOT NULL,
    [RequiredDate] DATE NOT NULL,
    [Comments] NVARCHAR(500),
    [PreparedBy] NVARCHAR(100) NOT NULL,
    [ReviewedBy] NVARCHAR(100),
    [ApprovedBy] NVARCHAR(100),
    [Email] NVARCHAR(100) NOT NULL,
    [SiRefNo] NVARCHAR(50),
    [Status] NVARCHAR(20) NOT NULL CONSTRAINT [PurchaseRequests_Status_df] DEFAULT 'PENDING',
    [IsPostedToSap] BIT NOT NULL CONSTRAINT [PurchaseRequests_IsPostedToSap_df] DEFAULT 0,
    [IsCancelled] BIT NOT NULL CONSTRAINT [PurchaseRequests_IsCancelled_df] DEFAULT 0,
    [AttemptCount] INT NOT NULL CONSTRAINT [PurchaseRequests_AttemptCount_df] DEFAULT 0,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [PurchaseRequests_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PurchaseRequests_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [PurchaseRequests_PrRefNo_key] UNIQUE NONCLUSTERED ([PrRefNo])
);

-- CreateTable
CREATE TABLE [dbo].[PurchaseRequestLines] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [PurchaseRequestId] INT NOT NULL,
    [ItemCode] NVARCHAR(50) NOT NULL,
    [Description] NVARCHAR(255) NOT NULL,
    [Quantity] DECIMAL(18,2) NOT NULL,
    [WarehouseCode] NVARCHAR(20) NOT NULL,
    [RequiredDate] DATE NOT NULL,
    [Price] DECIMAL(18,2) NOT NULL,
    [VendorCode] NVARCHAR(50),
    [LineRemarks] NVARCHAR(500),
    CONSTRAINT [PurchaseRequestLines_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[Projects] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [pin] NVARCHAR(50) NOT NULL,
    [projectName] NVARCHAR(255) NOT NULL,
    [projectDescription] NVARCHAR(500),
    [company] NVARCHAR(50) NOT NULL,
    [status] NVARCHAR(20) NOT NULL,
    [D5_ProjectCode] NVARCHAR(100),
    [d1ClientCode] NVARCHAR(100),
    [d2CostCenter] NVARCHAR(100),
    [d3BusTypeServiceType] NVARCHAR(150),
    [d4Location] NVARCHAR(100),
    [buCode] NVARCHAR(50),
    [BookEntry] NVARCHAR(50),
    [startDate] DATETIME,
    [endDate] DATETIME,
    [sap_status] NVARCHAR(20),
    [SapUploadStatus] NVARCHAR(20),
    [SapLastError] NVARCHAR(max),
    [SapRetryCount] INT NOT NULL CONSTRAINT [Projects_SapRetryCount_df] DEFAULT 0,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [Projects_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [UpdatedAt] DATETIME,
    CONSTRAINT [Projects_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [Projects_pin_key] UNIQUE NONCLUSTERED ([pin])
);

-- CreateTable
CREATE TABLE [dbo].[ProjectCostCenterSync] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [PIN] NVARCHAR(50) NOT NULL,
    [DimensionCode] INT NOT NULL,
    [Code] NVARCHAR(100) NOT NULL,
    [Name] NVARCHAR(255) NOT NULL,
    [Status] NVARCHAR(20) NOT NULL,
    [BookEntry] NVARCHAR(50),
    [StartDate] DATETIME,
    [EndDate] DATETIME,
    [SapStatus] NVARCHAR(20),
    [SapLastError] NVARCHAR(max),
    [SapRetryCount] INT NOT NULL CONSTRAINT [ProjectCostCenterSync_SapRetryCount_df] DEFAULT 0,
    [SapUploadedAt] DATETIME,
    [CreatedAt] DATETIME NOT NULL CONSTRAINT [ProjectCostCenterSync_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [UpdatedAt] DATETIME,
    CONSTRAINT [ProjectCostCenterSync_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[TransactionTypes] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [Code] NVARCHAR(100) NOT NULL,
    [IsActive] BIT NOT NULL CONSTRAINT [TransactionTypes_IsActive_df] DEFAULT 1,
    CONSTRAINT [TransactionTypes_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [TransactionTypes_Code_key] UNIQUE NONCLUSTERED ([Code])
);

-- CreateTable
CREATE TABLE [dbo].[AuditLogs] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [TransactionTypeId] INT NOT NULL,
    [RunId] UNIQUEIDENTIFIER NOT NULL,
    [Status] NVARCHAR(20) NOT NULL,
    [StartedAt] DATETIME NOT NULL,
    [EndedAt] DATETIME,
    [TotalRecords] INT NOT NULL CONSTRAINT [AuditLogs_TotalRecords_df] DEFAULT 0,
    [InsertedCount] INT NOT NULL CONSTRAINT [AuditLogs_InsertedCount_df] DEFAULT 0,
    [UpdatedCount] INT NOT NULL CONSTRAINT [AuditLogs_UpdatedCount_df] DEFAULT 0,
    [SkippedCount] INT NOT NULL CONSTRAINT [AuditLogs_SkippedCount_df] DEFAULT 0,
    [FailedCount] INT NOT NULL CONSTRAINT [AuditLogs_FailedCount_df] DEFAULT 0,
    [ErrorMessage] NVARCHAR(1000),
    CONSTRAINT [AuditLogs_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[AuditLogDetails] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [AuditLogId] INT NOT NULL,
    [Level] NVARCHAR(10) NOT NULL,
    [Step] NVARCHAR(50) NOT NULL,
    [Message] NVARCHAR(1000) NOT NULL,
    [ReferenceKey] NVARCHAR(100),
    CONSTRAINT [AuditLogDetails_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[AuditTransactionItems] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [AuditLogId] INT NOT NULL,
    [Entity] NVARCHAR(100) NOT NULL,
    [ReferenceKey] NVARCHAR(100) NOT NULL,
    [Action] NVARCHAR(20) NOT NULL,
    [Status] NVARCHAR(20) NOT NULL,
    [ErrorMessage] NVARCHAR(1000),
    [Payload] NVARCHAR(max),
    CONSTRAINT [AuditTransactionItems_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PurchaseOrderLines_PoNumber_idx] ON [dbo].[PurchaseOrderLines]([PoNumber]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PurchaseRequestLines_PurchaseRequestId_idx] ON [dbo].[PurchaseRequestLines]([PurchaseRequestId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ProjectCostCenterSync_PIN_idx] ON [dbo].[ProjectCostCenterSync]([PIN]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLogs_TransactionTypeId_idx] ON [dbo].[AuditLogs]([TransactionTypeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLogs_RunId_idx] ON [dbo].[AuditLogs]([RunId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLogDetails_AuditLogId_idx] ON [dbo].[AuditLogDetails]([AuditLogId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditTransactionItems_AuditLogId_idx] ON [dbo].[AuditTransactionItems]([AuditLogId]);

-- AddForeignKey
ALTER TABLE [dbo].[Items] ADD CONSTRAINT [Items_ItemClassCode_fkey] FOREIGN KEY ([ItemClassCode]) REFERENCES [dbo].[ItemClasses]([ItmsGrpCod]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Items] ADD CONSTRAINT [Items_UOM_ID_fkey] FOREIGN KEY ([UOM_ID]) REFERENCES [dbo].[Uoms]([Id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PurchaseOrderLines] ADD CONSTRAINT [PurchaseOrderLines_PoNumber_fkey] FOREIGN KEY ([PoNumber]) REFERENCES [dbo].[PurchaseOrders]([PoNumber]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PurchaseRequestLines] ADD CONSTRAINT [PurchaseRequestLines_PurchaseRequestId_fkey] FOREIGN KEY ([PurchaseRequestId]) REFERENCES [dbo].[PurchaseRequests]([Id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ProjectCostCenterSync] ADD CONSTRAINT [ProjectCostCenterSync_PIN_fkey] FOREIGN KEY ([PIN]) REFERENCES [dbo].[Projects]([pin]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLogs] ADD CONSTRAINT [AuditLogs_TransactionTypeId_fkey] FOREIGN KEY ([TransactionTypeId]) REFERENCES [dbo].[TransactionTypes]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLogDetails] ADD CONSTRAINT [AuditLogDetails_AuditLogId_fkey] FOREIGN KEY ([AuditLogId]) REFERENCES [dbo].[AuditLogs]([Id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AuditTransactionItems] ADD CONSTRAINT [AuditTransactionItems_AuditLogId_fkey] FOREIGN KEY ([AuditLogId]) REFERENCES [dbo].[AuditLogs]([Id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

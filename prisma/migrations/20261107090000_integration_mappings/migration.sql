CREATE TABLE [dbo].[IntegrationMappings] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [Provider] NVARCHAR(30) NOT NULL,
    [Module] NVARCHAR(50) NOT NULL,
    [ConfigJson] NVARCHAR(MAX) NOT NULL,
    [Enabled] BIT NOT NULL CONSTRAINT [IntegrationMappings_Enabled_df] DEFAULT 0,
    [Version] INT NOT NULL CONSTRAINT [IntegrationMappings_Version_df] DEFAULT 1,
    [UpdatedBy] NVARCHAR(255) NOT NULL,
    [UpdatedAt] DATETIME2 NOT NULL CONSTRAINT [IntegrationMappings_UpdatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [IntegrationMappings_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [IntegrationMappings_Provider_Module_key] UNIQUE ([Provider], [Module])
);

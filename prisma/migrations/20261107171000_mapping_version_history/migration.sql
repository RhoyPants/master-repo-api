CREATE TABLE [dbo].[IntegrationMappingVersions] (
    [Id] INT NOT NULL IDENTITY(1,1),
    [Provider] NVARCHAR(30) NOT NULL,
    [Module] NVARCHAR(50) NOT NULL,
    [ConfigJson] NVARCHAR(MAX) NOT NULL,
    [Enabled] BIT NOT NULL,
    [Version] INT NOT NULL,
    [UpdatedBy] NVARCHAR(255) NOT NULL,
    [UpdatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [IntegrationMappingVersions_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [IntegrationMappingVersions_Provider_Module_Version_key] UNIQUE ([Provider], [Module], [Version])
);

INSERT INTO [dbo].[IntegrationMappingVersions] ([Provider], [Module], [ConfigJson], [Enabled], [Version], [UpdatedBy], [UpdatedAt])
SELECT [Provider], [Module], [ConfigJson], [Enabled], [Version], [UpdatedBy], [UpdatedAt]
FROM [dbo].[IntegrationMappings];

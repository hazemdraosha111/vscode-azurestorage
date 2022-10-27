/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureDataTables from '@azure/data-tables';
import * as azureStorageBlob from '@azure/storage-blob';
import { AccountSASSignatureValues, generateAccountSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob';
import * as azureStorageShare from '@azure/storage-file-share';
import * as azureStorageQueue from '@azure/storage-queue';
import { AzExtParentTreeItem, AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import * as path from 'path';
import { emulatorAccountName, emulatorConnectionString, emulatorKey, getResourcesPath } from '../constants';
import { getPropertyFromConnectionString } from '../utils/getPropertyFromConnectionString';
import { localize } from '../utils/localize';
import { AttachedAccountRoot } from './AttachedStorageAccountsTreeItem';
import { BlobContainerGroupTreeItem } from './blob/BlobContainerGroupTreeItem';
import { FileShareGroupTreeItem } from './fileShare/FileShareGroupTreeItem';
import { IStorageRoot } from './IStorageRoot';
import { IStorageTreeItem } from './IStorageTreeItem';
import { StorageAccountTreeItem, WebsiteHostingStatus } from './StorageAccountTreeItem';

export class AttachedStorageAccountTreeItem extends AzExtParentTreeItem implements IStorageTreeItem {
    public childTypeLabel: string = 'resource type';
    public autoSelectInTreeItemPicker: boolean = true;
    public static baseContextValue: string = `${StorageAccountTreeItem.contextValue}-attached`;
    public static emulatedContextValue: string = `${AttachedStorageAccountTreeItem.baseContextValue}-emulated`;

    private readonly _blobContainerGroupTreeItem: BlobContainerGroupTreeItem;
    private readonly _fileShareGroupTreeItem: FileShareGroupTreeItem;
    private _root: IStorageRoot;

    constructor(
        parent: AzExtParentTreeItem,
        public readonly connectionString: string,
        private readonly storageAccountName: string) {
        super(parent);

        this.id = this.storageAccountName;
        this.iconPath = {
            light: path.join(getResourcesPath(), 'light', 'AzureStorageAccount.svg'),
            dark: path.join(getResourcesPath(), 'dark', 'AzureStorageAccount.svg')
        };

        this._root = new AttachedStorageRoot(connectionString, storageAccountName, this.storageAccountName === emulatorAccountName);
        this._blobContainerGroupTreeItem = new BlobContainerGroupTreeItem(this);
        this._fileShareGroupTreeItem = new FileShareGroupTreeItem(this);
    }

    public get root(): IStorageRoot {
        return this._root;
    }

    public get label(): string {
        return this.root.isEmulated ? localize('localEmulator', 'Local Emulator') : this.storageAccountName;
    }

    public get contextValue(): string {
        return this.root.isEmulated ? AttachedStorageAccountTreeItem.emulatedContextValue : AttachedStorageAccountTreeItem.baseContextValue;
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    public async loadMoreChildrenImpl(): Promise<AzExtTreeItem[]> {
        const groupTreeItems: AzExtTreeItem[] = [this._blobContainerGroupTreeItem];

        if (!this.root.isEmulated) {
            groupTreeItems.push(this._fileShareGroupTreeItem);
        }

        return groupTreeItems;
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public getConnectionString(): string {
        return this.connectionString;
    }

    public async getActualWebsiteHostingStatus(): Promise<WebsiteHostingStatus> {
        // Does NOT update treeItem's _webHostingEnabled.
        const serviceClient: azureStorageBlob.BlobServiceClient = this.root.createBlobServiceClient();
        const properties: azureStorageBlob.ServiceGetPropertiesResponse = await serviceClient.getProperties();
        const staticWebsite: azureStorageBlob.StaticWebsite | undefined = properties.staticWebsite;

        return {
            capable: !!staticWebsite,
            enabled: !!staticWebsite && staticWebsite.enabled,
            indexDocument: staticWebsite && staticWebsite.indexDocument,
            errorDocument404Path: staticWebsite && staticWebsite.errorDocument404Path
        };
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        return contextValue !== AttachedStorageAccountTreeItem.baseContextValue || !this.root.isEmulated;
    }
}

class AttachedStorageRoot extends AttachedAccountRoot {
    public storageAccountName: string;
    public isEmulated: boolean;

    private readonly _serviceClientPipelineOptions = { retryOptions: { maxTries: 2 } };
    private _connectionString: string;

    constructor(connectionString: string, storageAccountName: string, isEmulated: boolean) {
        super();
        this._connectionString = connectionString;
        this.storageAccountName = storageAccountName;
        this.isEmulated = isEmulated;
    }

    public get storageAccountId(): string {
        throw new Error(localize('cannotRetrieveStorageAccountIdForAttachedAccount', 'Cannot retrieve storage account id for an attached account.'));
    }

    public generateSasToken(accountSASSignatureValues: AccountSASSignatureValues): string {
        const key: string | undefined = this._connectionString === emulatorConnectionString ? emulatorKey : getPropertyFromConnectionString(this._connectionString, 'AccountKey');
        if (!key) {
            throw new Error(localize('noKeyConnectionString', 'Could not parse key from connection string'));
        }
        return generateAccountSASQueryParameters(
            accountSASSignatureValues,
            new StorageSharedKeyCredential(this.storageAccountName, key)
        ).toString();
    }

    public createBlobServiceClient(): azureStorageBlob.BlobServiceClient {
        return azureStorageBlob.BlobServiceClient.fromConnectionString(this._connectionString, this._serviceClientPipelineOptions);
    }

    public createShareServiceClient(): azureStorageShare.ShareServiceClient {
        return azureStorageShare.ShareServiceClient.fromConnectionString(this._connectionString, this._serviceClientPipelineOptions);
    }

    public createQueueServiceClient(): azureStorageQueue.QueueServiceClient {
        return azureStorageQueue.QueueServiceClient.fromConnectionString(this._connectionString, this._serviceClientPipelineOptions);
    }

    public createTableServiceClient(): azureDataTables.TableServiceClient {
        return azureDataTables.TableServiceClient.fromConnectionString(this._connectionString, { retryOptions: { maxRetries: this._serviceClientPipelineOptions.retryOptions.maxTries } });
    }
}

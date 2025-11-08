export enum JobType {
    Scheduled = 'scheduled',
    Manual = 'manual',
}

export enum JobStatus {
    Running = 'running',
    Completed = 'completed',
    Failed = 'failed',
}

export enum JobItemStatus {
    Pending = 'pending',
    Success = 'success',
    Failed = 'failed',
}

export enum ImageAssetStatus {
    Pending = 'pending',
    Uploaded = 'uploaded',
    Failed = 'failed',
}

export class Notice {
	constructor(_message: string) {}
}

export interface RequestUrlParam {
	url: string;
	method?: string;
	contentType?: string;
	body?: string | ArrayBuffer;
	throw?: boolean;
	headers?: Record<string, string>;
}

export interface RequestUrlResponse {
	status: number;
	text: string;
	json: unknown;
	arrayBuffer: ArrayBuffer;
	headers: Record<string, string>;
}

export async function requestUrl(
	_params: RequestUrlParam,
): Promise<RequestUrlResponse> {
	throw new Error("requestUrl is not implemented in the test mock.");
}

export interface DataAdapter {
	read(path: string): Promise<string>;
	readBinary(path: string): Promise<ArrayBuffer>;
	write(path: string, data: string): Promise<void>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	remove(path: string): Promise<void>;
	rename(oldPath: string, newPath: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	mkdir(path: string): Promise<void>;
	stat(
		path: string,
	): Promise<{ size: number; ctime: number; mtime: number } | null>;
}

export class Plugin {}

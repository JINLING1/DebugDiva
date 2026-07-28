export interface ChatMessage {
	id: string;
	message: string;
	isUser: boolean;
	isComplete: boolean;
	reasoning?: string;
}

export interface ChatSession {
	id: string;
	title: string;
	date: string;
	messages: ChatMessage[];
}

//handleChat的参数
export interface ChatParams {
	input?: string; //输入内容
	userInput?: string; //需要ai重新回答时的输入
	updateIndex?: number;
}

import ChatMessage from "../ChatMessage";
import {
    type ChangeEvent,
    type KeyboardEvent,
    type ReactElement,
    type RefObject,
} from "react";
import { type ChatTimelineMessage } from "../../types";
import "./style.css";

interface ChatConsoleState {
    modelName: string;
    productsCount: number;
    question: string;
    chatMessages: ChatTimelineMessage[];
    isAiLoading: boolean;
    chatFeedRef: RefObject<HTMLDivElement | null>;
}

interface ChatConsoleActions {
    onQuestionChange: (value: string) => void;
    onQuestionKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    onAsk: () => Promise<void>;
    onReset: () => void;
}

interface IChatConsoleProps {
    chatState: ChatConsoleState;
    chatActions: ChatConsoleActions;
}

const getAskButtonLabel = (isAiLoading: boolean): string => {
    return isAiLoading ? "Отвечаю..." : "Спросить склад";
};

const ChatEmptyState = (): ReactElement => {
    return (
        <div className="chat-empty">
            <strong>Спроси по остаткам, ценам или категориям</strong>
            <span>
                Ответ будет построен только на данных текущего каталога.
            </span>
        </div>
    );
};

const ChatConsole = ({
    chatState,
    chatActions,
}: IChatConsoleProps): ReactElement => {
    const {
        modelName,
        productsCount,
        question,
        chatMessages,
        isAiLoading,
        chatFeedRef,
    } = chatState;
    const { onQuestionChange, onQuestionKeyDown, onAsk, onReset } =
        chatActions;
    const hasChatMessages = chatMessages.length > 0;

    const isAskDisabled =
        productsCount === 0 || isAiLoading || !question.trim();

    const handleAskClick = (): void => {
        void onAsk();
    };

    const handleQuestionChange = (
        event: ChangeEvent<HTMLInputElement>,
    ): void => {
        onQuestionChange(event.target.value);
    };

    const askButtonLabel = getAskButtonLabel(isAiLoading);

    return (
        <aside className="chat-console" aria-label="Чат со складом">
            <header className="section-header section-header--chat">
                <div>
                    <span className="section-eyebrow">Локальный AI</span>

                    <h2>Чат со складом</h2>
                </div>
                <span className="model-chip">{modelName}</span>
            </header>
            <div className="context-strip">
                <span>Источник ответов</span>
                <strong>
                    {productsCount > 0
                        ? `${productsCount} товаров из локального каталога`
                        : "каталог недоступен"}
                </strong>
            </div>
            <div className="chat-feed" ref={chatFeedRef}>
                {!hasChatMessages && <ChatEmptyState />}
                {chatMessages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                ))}
            </div>
            <div className="chat-controls">
                <input
                    type="text"
                    value={question}
                    onChange={handleQuestionChange}
                    onKeyDown={onQuestionKeyDown}
                    placeholder="Например: что закончилось?"
                    disabled={isAiLoading}
                />
                <div className="button-row">
                    <button
                        className="primary-action"
                        type="button"
                        onClick={handleAskClick}
                        disabled={isAskDisabled}
                    >
                        {askButtonLabel}
                    </button>
                    <button
                        className="secondary-action"
                        type="button"
                        onClick={onReset}
                        disabled={isAiLoading}
                    >
                        Новый диалог
                    </button>
                </div>
            </div>
        </aside>
    );
};

export default ChatConsole;

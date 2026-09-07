import ChatMessage from "../ChatMessage";
import { type KeyboardEvent, type ReactElement, type RefObject } from "react";
import { type ChatTimelineMessage } from "../../types";
import "./style.css";

interface IChatConsoleProps {
    modelName: string;
    productsCount: number;
    question: string;
    chatMessages: ChatTimelineMessage[];
    isAiLoading: boolean;
    chatFeedRef: RefObject<HTMLDivElement | null>;
    onQuestionChange: (value: string) => void;
    onQuestionKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    onAsk: () => Promise<void>;
    onReset: () => void;
}

const ChatConsole = ({
    modelName,
    productsCount,
    question,
    chatMessages,
    isAiLoading,
    chatFeedRef,
    onQuestionChange,
    onQuestionKeyDown,
    onAsk,
    onReset,
}: IChatConsoleProps): ReactElement => {
    const hasChatMessages = chatMessages.length > 0;

    const isAskDisabled =
        productsCount === 0 || isAiLoading || !question.trim();

    const handleAskClick = (): void => {
        void onAsk();
    };

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
                {!hasChatMessages && (
                    <div className="chat-empty">
                        <strong>
                            Спроси по остаткам, ценам или категориям
                        </strong>
                        <span>
                            Ответ будет построен только на данных текущего
                            каталога.
                        </span>
                    </div>
                )}
                {chatMessages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                ))}
            </div>
            <div className="chat-controls">
                <input
                    type="text"
                    value={question}
                    onChange={(event) => {
                        onQuestionChange(event.target.value);
                    }}
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
                        {isAiLoading ? "Отвечаю..." : "Спросить склад"}
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

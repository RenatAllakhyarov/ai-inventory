import { type ChatTimelineMessage } from "../../types";
import { type ReactElement } from "react";
import "./style.css";

interface IChatMessageProps {
    message: ChatTimelineMessage;
}

const getChatMessageLabel = (message: ChatTimelineMessage): string => {
    if (message.role === "user") {
        return "Ты";
    }

    if (message.role === "error") {
        return "Ошибка";
    }

    if (message.status === "pending") {
        return "Склад думает";
    }

    return "Ответ склада";
};

const ChatMessage = ({ message }: IChatMessageProps): ReactElement => {
    const className = [
        "chat-message",
        `chat-message--${message.role}`,
        message.status === "pending" ? "chat-message--pending" : "",
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <div className={className} key={message.id}>
            <span>{getChatMessageLabel(message)}</span>
            <p>{message.content}</p>
        </div>
    );
};

export default ChatMessage;

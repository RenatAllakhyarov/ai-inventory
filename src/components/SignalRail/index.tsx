import { type ConnectionTone } from "../../types";
import { type ReactElement } from "react";
import "./style.css";

interface SignalRailSignals {
    sourceName: string;
    connectionLabel: string;
    connectionTone: ConnectionTone;
    catalogLabel: string;
    aiContextLabel: string;
    hasProducts: boolean;
}

interface ISignalRailProps {
    signals: SignalRailSignals;
}

const SignalRail = ({ signals }: ISignalRailProps): ReactElement => {
    const {
        sourceName,
        connectionLabel,
        connectionTone,
        catalogLabel,
        aiContextLabel,
        hasProducts,
    } = signals;
    const aiContextTone = hasProducts ? "good" : "pending";

    return (
        <section className="signal-rail" aria-label="Статус склада">
            <div className="brand-block">
                <span className="brand-kicker">AI Inventory</span>
                <h1>Складской пульт</h1>
            </div>
            <div className="signal-grid">
                <div className={`signal-cell signal-cell--${connectionTone}`}>
                    <span className="signal-label">{sourceName}</span>
                    <strong>{connectionLabel}</strong>
                </div>
                <div className="signal-cell">
                    <span className="signal-label">Каталог</span>
                    <strong>{catalogLabel}</strong>
                </div>
                <div className={`signal-cell signal-cell--${aiContextTone}`}>
                    <span className="signal-label">AI контекст</span>
                    <strong>{aiContextLabel}</strong>
                </div>
                <div className="signal-cell">
                    <span className="signal-label">Синхронизация</span>
                    <strong>5 минут</strong>
                </div>
            </div>
        </section>
    );
};

export default SignalRail;

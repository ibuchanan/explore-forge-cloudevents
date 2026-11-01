// Generated from src/events.ts via src/generate-events.ts; do not edit.
export type PeerEvents = PingEvent | PongEvent;

export interface PingEvent {
  'specversion': '1.0';
  'id': string;
  'source': string;
  'traceparent'?: any;
  'type': 'ping';
  'data': AnonymousSchema_6;
}

export interface AnonymousSchema_6 {

}

export interface PongEvent {
  'specversion': '1.0';
  'id': string;
  'source': string;
  'traceparent'?: any;
  'type': 'pong';
  'data': AnonymousSchema_12;
}

export interface AnonymousSchema_12 {
  'pingId': string;
}

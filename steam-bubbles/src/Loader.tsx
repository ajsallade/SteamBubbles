type LoaderProps = {
  visible: boolean;
  message: string;
};

export default function Loader({ visible, message }: LoaderProps) {
  if (!visible) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        color: "white",
        fontSize: "1.5em",
      }}>
      <div
        style={{
          fontSize: "2em",
        }}>
        {message}
      </div>
    </div>
  );
}

/// Multi-process Hydro flows for testing distributed visualization
/// 
/// These examples demonstrate Hydro's distributed capabilities with
/// multiple processes communicating over the network.
use dfir_rs::dfir_syntax;
use dfir_rs::scheduled::graph::Dfir;

/// A simple client-server echo flow
/// 
/// This demonstrates basic network communication in Hydro.
pub fn echo_server_flow() -> Dfir<'static> {
    dfir_syntax! {
        // Simulated network input
        network_input = source_iter([
            "Hello",
            "World",
            "Echo",
        ]);
        
        // Echo back
        network_input
            -> map(|msg| format!("Echo: {}", msg))
            -> for_each(|response| println!("{}", response));
    }
}

/// A flow with multiple processes (simulated)
/// 
/// This demonstrates how Hydro can coordinate multiple processes.
pub fn multi_process_coordination_flow() -> Dfir<'static> {
    dfir_syntax! {
        // Process 1: Generate data
        process1_data = source_iter(1..=5)
            -> map(|n| format!("P1-{}", n));
        
        // Process 2: Generate data
        process2_data = source_iter(6..=10)
            -> map(|n| format!("P2-{}", n));
        
        // Merge data from both processes
        merged = union();
        process1_data -> [0]merged;
        process2_data -> [1]merged;
        
        // Coordinator process
        merged
            -> for_each(|msg| println!("Coordinator received: {}", msg));
    }
}

/// A flow demonstrating broadcast pattern
/// 
/// One process broadcasts to multiple receivers.
pub fn broadcast_flow() -> Dfir<'static> {
    dfir_syntax! {
        // Broadcaster
        broadcast_source = source_iter([
            "Announcement 1",
            "Announcement 2",
            "Announcement 3",
        ]) -> tee();
        
        // Receiver 1
        broadcast_source[0]
            -> for_each(|msg| println!("Receiver 1: {}", msg));
        
        // Receiver 2
        broadcast_source[1]
            -> for_each(|msg| println!("Receiver 2: {}", msg));
        
        // Receiver 3
        broadcast_source[2]
            -> for_each(|msg| println!("Receiver 3: {}", msg));
    }
}

/// A flow demonstrating aggregation from multiple sources
/// 
/// Multiple processes send data to a central aggregator.
pub fn aggregation_flow() -> Dfir<'static> {
    dfir_syntax! {
        // Aggregator receives from multiple sources
        aggregator = union();
        
        // Source 1
        source_iter([("sensor1", 23.5), ("sensor1", 24.0)])
            -> [0]aggregator;
        
        // Source 2
        source_iter([("sensor2", 22.0), ("sensor2", 23.0)])
            -> [1]aggregator;
        
        // Source 3
        source_iter([("sensor3", 25.0), ("sensor3", 24.5)])
            -> [2]aggregator;
        
        // Aggregate by sensor
        aggregator
            -> fold_keyed::<'static>(|| 0.0, |acc, val| *acc += val)
            -> for_each(|(sensor, total)| {
                println!("Sensor: {}, Total: {}", sensor, total);
            });
    }
}

/// A flow with request-response pattern
/// 
/// Demonstrates bidirectional communication between processes.
pub fn request_response_flow() -> Dfir<'static> {
    dfir_syntax! {
        // Client sends requests
        requests = source_iter([
            ("get", "user1"),
            ("get", "user2"),
            ("set", "user3"),
        ]) -> tee();
        
        // Server processes requests
        responses = requests[0]
            -> map(|(op, key)| {
                match op {
                    "get" => format!("Response: Retrieved {}", key),
                    "set" => format!("Response: Set {}", key),
                    _ => format!("Response: Unknown operation"),
                }
            });
        
        // Client receives responses
        responses
            -> for_each(|resp| println!("{}", resp));
        
        // Also log requests
        requests[1]
            -> for_each(|(op, key)| println!("Request: {} {}", op, key));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_echo_server() {
        let mut flow = echo_server_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_multi_process_coordination() {
        let mut flow = multi_process_coordination_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_broadcast() {
        let mut flow = broadcast_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_aggregation() {
        let mut flow = aggregation_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_request_response() {
        let mut flow = request_response_flow();
        flow.run_available_sync();
    }
}

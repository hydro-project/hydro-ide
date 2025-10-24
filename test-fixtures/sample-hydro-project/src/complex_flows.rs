/// More complex Hydro flows for testing advanced visualization features
use dfir_rs::dfir_syntax;
use dfir_rs::scheduled::graph::Dfir;

/// A flow with nested operations and state
/// 
/// This demonstrates stateful operations with fold.
pub fn stateful_flow() -> Dfir<'static> {
    dfir_syntax! {
        source_iter(1..=10)
            -> fold::<'static>(|| 0, |state, n| *state += n)
            -> for_each(|running_sum| println!("Running sum: {}", running_sum));
    }
}

/// A flow with multiple joins and aggregations
/// 
/// This creates a more complex graph with multiple join operations.
pub fn multi_join_flow() -> Dfir<'static> {
    dfir_syntax! {
        // Three data sources
        users = source_iter([
            (1, "Alice"),
            (2, "Bob"),
            (3, "Charlie"),
        ]);
        
        orders = source_iter([
            (1, 1, "Book"),    // (order_id, user_id, item)
            (2, 2, "Laptop"),
            (3, 1, "Pen"),
        ]);
        
        payments = source_iter([
            (1, 100),  // (order_id, amount)
            (2, 1000),
            (3, 5),
        ]);
        
        // Join orders with users
        join1 = join::<'tick>();
        orders -> map(|(order_id, user_id, item)| (user_id, (order_id, item))) -> [0]join1;
        users -> [1]join1;
        
        user_orders = join1 -> map(|(user_id, ((order_id, item), name))| (order_id, (user_id, name, item)));
        
        // Join with payments
        join2 = join::<'tick>();
        user_orders -> [0]join2;
        payments -> [1]join2;
        
        join2
            -> for_each(|(order_id, ((_user_id, name, item), amount))| {
                println!("Order {}: {} bought {} for ${}", order_id, name, item, amount);
            });
    }
}

/// A flow with cross product
/// 
/// This demonstrates cross_join for creating all combinations.
pub fn cross_product_flow() -> Dfir<'static> {
    dfir_syntax! {
        colors = source_iter(["Red", "Green", "Blue"]);
        sizes = source_iter(["Small", "Medium", "Large"]);
        
        cross = cross_join::<'tick>();
        colors -> [0]cross;
        sizes -> [1]cross;
        
        cross
            -> for_each(|(color, size)| {
                println!("{} {}", size, color);
            });
    }
}

/// A flow with reduce_keyed for grouping
/// 
/// This demonstrates grouping and aggregation by key.
pub fn group_and_aggregate_flow() -> Dfir<'static> {
    dfir_syntax! {
        source_iter([
            ("A", 10),
            ("B", 20),
            ("A", 15),
            ("C", 30),
            ("B", 25),
            ("A", 5),
        ])
            -> fold_keyed::<'static>(|| 0, |acc, val| *acc += val)
            -> for_each(|(key, sum)| {
                println!("Key: {}, Sum: {}", key, sum);
            });
    }
}

/// A flow with multiple tees and complex routing
/// 
/// This creates a complex graph with multiple branches and merges.
pub fn complex_routing_flow() -> Dfir<'static> {
    dfir_syntax! {
        // Main source
        source = source_iter(1..=20) -> tee();
        
        // Branch 1: Process multiples of 3
        branch1 = source[0]
            -> filter(|n| n % 3 == 0)
            -> map(|n| format!("Div3: {}", n))
            -> tee();
        
        // Branch 2: Process multiples of 5
        branch2 = source[1]
            -> filter(|n| n % 5 == 0)
            -> map(|n| format!("Div5: {}", n))
            -> tee();
        
        // Merge some branches
        merged = union();
        branch1[0] -> [0]merged;
        branch2[0] -> [1]merged;
        
        // Output merged results
        merged -> for_each(|s| println!("Merged: {}", s));
        
        // Also output remaining branches separately
        branch1[1] -> for_each(|s| println!("Only 3: {}", s));
        branch2[1] -> for_each(|s| println!("Only 5: {}", s));
    }
}

/// A flow with persist for maintaining state across ticks
/// 
/// This demonstrates stateful operations that persist across iterations.
pub fn persistent_state_flow() -> Dfir<'static> {
    dfir_syntax! {
        // Initialize with some values
        init = source_iter([1, 2, 3]);
        
        // Persist state
        state = init -> persist::<'static>();
        
        // Use persisted state
        state
            -> map(|n| n * 2)
            -> for_each(|n| println!("Doubled: {}", n));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stateful() {
        let mut flow = stateful_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_multi_join() {
        let mut flow = multi_join_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_cross_product() {
        let mut flow = cross_product_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_group_and_aggregate() {
        let mut flow = group_and_aggregate_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_complex_routing() {
        let mut flow = complex_routing_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_persistent_state() {
        let mut flow = persistent_state_flow();
        flow.run_available_sync();
    }
}

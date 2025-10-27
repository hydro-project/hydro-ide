// Complex Hydro flows for testing (non-DFIR version)
use hydro_lang::prelude::*;

#[hydro::flow]
pub fn complex_flow<'a>(flow: &FlowBuilder<'a>) -> (Process<'a, ()>, Cluster<'a, ()>) {
    let process = flow.process();
    let cluster = flow.cluster();
    
    let data = process
        .source_iter(q!(vec![1, 2, 3, 4, 5]))
        .map(q!(|x| x * x))
        .filter(q!(|&x| x > 5));
    
    data.clone()
        .send_bincode(&cluster)
        .for_each(q!(|x| println!("Cluster: {}", x)));
    
    data.fold(q!(|| 0), q!(|acc, x| *acc += x))
        .for_each(q!(|sum| println!("Sum: {}", sum)));
    
    (process, cluster)
}